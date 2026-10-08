import { createHash, randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

const MAX_BATCH_SIZE = 100;
const MAX_ATTRIBUTE_BYTES = 2_048;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
const MAX_OFFLINE_EVENT_AGE_MS = 7 * 24 * 60 * 60_000;

const attributeValueSchema = z.union([z.string().max(256), z.number(), z.boolean(), z.null()]);

const activityEventSchema = z
  .object({
    eventId: z.string().uuid(),
    productId: z.string().uuid(),
    eventType: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
    eventVersion: z.number().int().min(1).max(32_767).default(1),
    clientSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.string().datetime({ offset: true }),
    attributes: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,49}$/), attributeValueSchema)
      .default({})
      .refine(
        (attributes) => Object.keys(attributes).length <= 16,
        "Events may include at most 16 attributes.",
      ),
  })
  .strict();

const activityBatchSchema = z
  .object({ events: z.array(activityEventSchema).min(1).max(MAX_BATCH_SIZE) })
  .strict();
const activityListQuerySchema = z
  .object({
    productId: z.string().uuid().optional(),
    since: z.string().datetime({ offset: true }).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.before) !== Boolean(value.beforeId)) {
      context.addIssue({
        code: "custom",
        message: "A complete activity cursor is required.",
        path: ["beforeId"],
      });
    }
  });

type ActivityEvent = z.infer<typeof activityEventSchema>;

interface NormalizedEvent extends ActivityEvent {
  eventId: string;
  productId: string;
  occurredAt: string;
  attributes: Record<string, string | number | boolean | null>;
  hash: string;
}

interface StoredEvent {
  client_event_id: string;
  event_hash: string;
  effective_at: Date;
  clock_adjusted: boolean;
  client_sequence: string;
}

interface IngestedEvent {
  client_event_id: string;
  effective_at: Date;
  clock_adjusted: boolean;
}

class ActivityRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function normalizeEvent(event: ActivityEvent): NormalizedEvent {
  const attributes = Object.fromEntries(
    Object.entries(event.attributes).sort(([left], [right]) => left.localeCompare(right)),
  );
  const normalized = {
    ...event,
    eventId: event.eventId.toLowerCase(),
    productId: event.productId.toLowerCase(),
    occurredAt: new Date(event.occurredAt).toISOString(),
    attributes,
  };
  if (Buffer.byteLength(JSON.stringify(attributes), "utf8") > MAX_ATTRIBUTE_BYTES) {
    throw new ActivityRequestError(400, "Event attributes exceed the 2 KB limit.");
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        productId: normalized.productId,
        eventType: normalized.eventType,
        eventVersion: normalized.eventVersion,
        clientSequence: normalized.clientSequence,
        occurredAt: normalized.occurredAt,
        attributes: normalized.attributes,
      }),
    )
    .digest("hex");
  return { ...normalized, hash };
}

function parseEvents(values: ActivityEvent[]): NormalizedEvent[] {
  const hashesByEventId = new Map<string, string>();
  const uniqueEvents = new Map<string, NormalizedEvent>();
  const sequences = new Map<string, string>();

  for (const value of values) {
    const event = normalizeEvent(value);
    const priorHash = hashesByEventId.get(event.eventId);
    if (priorHash && priorHash !== event.hash) {
      throw new ActivityRequestError(409, "An event ID was reused with different event data.");
    }
    hashesByEventId.set(event.eventId, event.hash);
    if (uniqueEvents.has(event.eventId)) continue;

    const sequenceKey = `${event.productId}:${event.clientSequence}`;
    const priorEventId = sequences.get(sequenceKey);
    if (priorEventId && priorEventId !== event.eventId) {
      throw new ActivityRequestError(409, "A client sequence was reused for another event.");
    }
    sequences.set(sequenceKey, event.eventId);
    uniqueEvents.set(event.eventId, event);
  }
  return [...uniqueEvents.values()];
}

async function ingestActivityEvents(
  userId: string,
  deviceId: string,
  submittedEvents: ActivityEvent[],
) {
  const events = parseEvents(submittedEvents);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const consent = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM enough.privacy_consents WHERE user_id = $1 AND purpose = 'ACTIVITY_COLLECTION' FOR SHARE",
      [userId],
    );
    if (!consent.rows[0]?.enabled) {
      throw new ActivityRequestError(
        403,
        "Activity collection is disabled. Grant activity consent in Privacy settings to record events.",
      );
    }
    const productIds = [...new Set(events.map((event) => event.productId))];
    const ownedProducts = await client.query<{ id: string }>(
      "SELECT id FROM enough.products WHERE user_id = $1 AND id = ANY($2::uuid[])",
      [userId, productIds],
    );
    if (ownedProducts.rowCount !== productIds.length) {
      throw new ActivityRequestError(404, "One or more products were not found.");
    }

    const clock = await client.query<{ server_time: Date }>(
      "SELECT clock_timestamp() AS server_time",
    );
    const serverTime = clock.rows[0].server_time;
    const prepared = events.map((event) => {
      const occurredAt = new Date(event.occurredAt);
      const eventTime = occurredAt.getTime();
      const serverMillis = serverTime.getTime();
      const clockAdjusted =
        eventTime > serverMillis + FUTURE_CLOCK_TOLERANCE_MS ||
        eventTime < serverMillis - MAX_OFFLINE_EVENT_AGE_MS;
      return {
        event,
        effectiveAt: clockAdjusted ? serverTime : occurredAt,
        clockAdjusted,
      };
    });
    const batchId = randomUUID();
    const inserted = await client.query<IngestedEvent>(
      `WITH supplied AS (
         SELECT * FROM unnest(
           $4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::smallint[],
           $9::bigint[], $10::timestamptz[], $11::timestamptz[], $12::boolean[],
           $13::jsonb[], $14::text[]
         ) AS input(id, client_event_id, product_id, event_type, event_version,
                    client_sequence, client_occurred_at, effective_at, clock_adjusted,
                    attributes, event_hash)
       ), inserted AS (
         INSERT INTO enough.activity_events
           (id, user_id, product_id, device_id, client_event_id, event_type, event_version,
            client_sequence, client_occurred_at, effective_at, clock_adjusted, attributes,
            event_hash, batch_id)
         SELECT input.id, $1, input.product_id, $2, input.client_event_id, input.event_type,
                input.event_version, input.client_sequence, input.client_occurred_at,
                input.effective_at, input.clock_adjusted, input.attributes, input.event_hash, $3
         FROM supplied AS input
         ON CONFLICT DO NOTHING
         RETURNING client_event_id, product_id, event_type, effective_at, clock_adjusted
       ), hourly AS (
         SELECT product_id, event_type,
                date_trunc('hour', effective_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start,
                count(*)::bigint AS event_count, max(effective_at) AS last_event_at
         FROM inserted
         GROUP BY product_id, event_type, bucket_start
       ), aggregated AS (
         INSERT INTO enough.activity_event_aggregates AS stored
           (product_id, event_type, bucket_start, event_count, last_event_at)
         SELECT product_id, event_type, bucket_start, event_count, last_event_at FROM hourly
         ON CONFLICT (product_id, event_type, bucket_start) DO UPDATE
           SET event_count = stored.event_count + EXCLUDED.event_count,
               last_event_at = GREATEST(stored.last_event_at, EXCLUDED.last_event_at),
               updated_at = now()
         RETURNING product_id
       )
       SELECT inserted.client_event_id, inserted.effective_at, inserted.clock_adjusted
       FROM inserted CROSS JOIN (SELECT count(*) FROM aggregated) AS rollup`,
      [
        userId,
        deviceId,
        batchId,
        prepared.map(() => randomUUID()),
        events.map((event) => event.eventId),
        events.map((event) => event.productId),
        events.map((event) => event.eventType),
        events.map((event) => event.eventVersion),
        events.map((event) => String(event.clientSequence)),
        events.map((event) => event.occurredAt),
        prepared.map((event) => event.effectiveAt.toISOString()),
        prepared.map((event) => event.clockAdjusted),
        events.map((event) => JSON.stringify(event.attributes)),
        events.map((event) => event.hash),
      ],
    );

    const storedResult = await client.query<StoredEvent>(
      `SELECT client_event_id, event_hash, effective_at, clock_adjusted,
              client_sequence::text AS client_sequence
       FROM enough.activity_events
       WHERE user_id = $1 AND client_event_id = ANY($2::uuid[])`,
      [userId, events.map((event) => event.eventId)],
    );
    const storedByEventId = new Map(
      storedResult.rows.map((row) => [row.client_event_id, row] as const),
    );
    if (storedByEventId.size !== events.length) {
      throw new ActivityRequestError(409, "A client sequence was already used for another event.");
    }
    for (const event of events) {
      if (storedByEventId.get(event.eventId)?.event_hash !== event.hash) {
        throw new ActivityRequestError(
          409,
          "An event ID was already used with different event data.",
        );
      }
    }

    const acceptedCount = inserted.rows.length;
    const duplicateCount = submittedEvents.length - acceptedCount;
    const adjustedCount = inserted.rows.filter((event) => event.clock_adjusted).length;
    if (acceptedCount > 0) {
      await client.query(
        `INSERT INTO enough.auth_audit_events (id, user_id, device_id, event_type, metadata)
         VALUES ($1, $2, $3, 'activity.events_ingested', $4::jsonb)`,
        [
          randomUUID(),
          userId,
          deviceId,
          JSON.stringify({ batchId, accepted: acceptedCount, duplicates: duplicateCount }),
        ],
      );
    }
    await client.query("COMMIT");

    const acceptedIds = new Set(inserted.rows.map((event) => event.client_event_id));
    const emittedIds = new Set<string>();
    const responseEvents = submittedEvents
      .map((submitted) => {
        const eventId = submitted.eventId.toLowerCase();
        const stored = storedByEventId.get(eventId);
        if (!stored) throw new Error("Submitted event was not persisted.");
        const firstOccurrence = !emittedIds.has(eventId);
        emittedIds.add(eventId);
        return {
          eventId,
          productId: submitted.productId.toLowerCase(),
          clientSequence: Number(stored.client_sequence),
          status: firstOccurrence && acceptedIds.has(eventId) ? "accepted" : "duplicate",
          effectiveAt: stored.effective_at.toISOString(),
          clockAdjusted: stored.clock_adjusted,
        };
      })
      .sort(
        (left, right) =>
          left.productId.localeCompare(right.productId) ||
          left.clientSequence - right.clientSequence ||
          left.eventId.localeCompare(right.eventId),
      );

    return {
      batchId,
      serverTime: serverTime.toISOString(),
      received: submittedEvents.length,
      accepted: acceptedCount,
      duplicates: duplicateCount,
      clockAdjusted: adjustedCount,
      events: responseEvents,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sendIngestError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ActivityRequestError)
    return reply.code(error.statusCode).send({ error: error.message });
  request.log.error({ err: error }, "Could not ingest activity events");
  return reply
    .code(503)
    .send({ error: "Activity could not be recorded. Retry the same event IDs shortly." });
}

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/activity/events", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "activity:read", session.id, 120, 60))) return;
    const parsed = activityListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid activity filter." });
    try {
      if (parsed.data.productId) {
        const owned = await pool.query(
          "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
          [parsed.data.productId, session.id],
        );
        if (owned.rowCount !== 1) return reply.code(404).send({ error: "Product not found." });
      }
      const result = await pool.query<{
        id: string;
        product_id: string;
        product_name: string;
        device_id: string | null;
        client_event_id: string;
        event_type: string;
        event_version: number;
        client_sequence: string;
        client_occurred_at: Date;
        effective_at: Date;
        cursor_timestamp: string;
        received_at: Date;
        clock_adjusted: boolean;
        attributes: Record<string, string | number | boolean | null>;
        batch_id: string;
      }>(
        `SELECT event.id, event.product_id, product.name AS product_name, event.device_id,
                event.client_event_id, event.event_type, event.event_version,
                event.client_sequence::text, event.client_occurred_at, event.effective_at,
                to_char(event.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_timestamp,
                event.received_at, event.clock_adjusted, event.attributes, event.batch_id
         FROM enough.activity_events event
         JOIN enough.products product ON product.id = event.product_id AND product.user_id = event.user_id
         WHERE event.user_id = $1
           AND ($2::uuid IS NULL OR event.product_id = $2)
           AND ($3::timestamptz IS NULL OR event.effective_at >= $3)
           AND ($4::timestamptz IS NULL OR (event.effective_at, event.id) < ($4::timestamptz, $5::uuid))
         ORDER BY event.effective_at DESC, event.id DESC
         LIMIT $6`,
        [
          session.id,
          parsed.data.productId ?? null,
          parsed.data.since ?? null,
          parsed.data.before ?? null,
          parsed.data.beforeId ?? null,
          parsed.data.limit + 1,
        ],
      );
      const pageRows = result.rows.slice(0, parsed.data.limit);
      const lastRow = pageRows.at(-1);
      return reply.send({
        events: pageRows.map((row) => ({
          id: row.id,
          productId: row.product_id,
          productName: row.product_name,
          deviceId: row.device_id,
          eventId: row.client_event_id,
          eventType: row.event_type,
          eventVersion: row.event_version,
          clientSequence: Number(row.client_sequence),
          occurredAt: row.client_occurred_at.toISOString(),
          effectiveAt: row.effective_at.toISOString(),
          receivedAt: row.received_at.toISOString(),
          clockAdjusted: row.clock_adjusted,
          attributes: row.attributes,
          batchId: row.batch_id,
        })),
        nextCursor:
          result.rows.length > parsed.data.limit && lastRow
            ? {
                before: lastRow.cursor_timestamp,
                beforeId: lastRow.id,
              }
            : null,
      });
    } catch (error) {
      request.log.error({ err: error }, "Could not read activity events");
      return reply.code(503).send({ error: "Activity history is temporarily unavailable." });
    }
  });

  app.post("/activity/events", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    const parsed = activityEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the activity event." });
    }
    if (
      !(await checkRateLimit(request, reply, "activity:request", session.id, 120, 60)) ||
      !(await checkRateLimit(request, reply, "activity:volume", session.id, 1_000, 60))
    )
      return;
    try {
      return reply.send(await ingestActivityEvents(session.id, session.deviceId, [parsed.data]));
    } catch (error) {
      return sendIngestError(request, reply, error);
    }
  });

  app.post("/activity/batch", { bodyLimit: 300 * 1024 }, async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    const parsed = activityBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the activity batch." });
    }
    if (
      !(await checkRateLimit(request, reply, "activity:request", session.id, 120, 60)) ||
      !(await checkRateLimit(
        request,
        reply,
        "activity:volume",
        session.id,
        1_000,
        60,
        parsed.data.events.length,
      ))
    )
      return;
    try {
      return reply.send(
        await ingestActivityEvents(session.id, session.deviceId, parsed.data.events),
      );
    } catch (error) {
      return sendIngestError(request, reply, error);
    }
  });
}

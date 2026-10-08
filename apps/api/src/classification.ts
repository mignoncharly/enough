import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { pool } from "@enough/db";
import {
  normalizeToolKey,
  resolveToolClassification,
  TOOL_CLASSIFICATIONS,
  TOOL_KINDS,
  type ToolClassification,
  type ToolClassificationEntry,
  type ToolKind,
} from "@enough/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

interface CatalogRow {
  tool_kind: ToolKind;
  tool_key: string;
  display_name: string;
  classification: ToolClassification;
}

interface MappingRow extends CatalogRow {
  id: string;
  user_id: string;
  product_id: string | null;
  product_name?: string | null;
  context_key: string;
  context_value: string;
  created_at: Date;
  updated_at: Date;
}

const mappingSchema = z
  .object({
    toolKind: z.enum(TOOL_KINDS),
    toolKey: z.string().trim().min(1).max(500),
    displayName: z.string().trim().min(1).max(120),
    classification: z.enum(TOOL_CLASSIFICATIONS),
    productId: z.string().uuid().nullable().optional(),
    contextKey: z.string().trim().max(80).optional().default(""),
    contextValue: z.string().trim().max(160).optional().default(""),
  })
  .refine((body) => Boolean(body.contextKey) === Boolean(body.contextValue), {
    message: "Enter both a context name and value, or leave both blank.",
  });

const resolveSchema = z
  .object({
    toolKind: z.enum(TOOL_KINDS),
    toolKey: z.string().trim().min(1).max(500),
    productId: z.string().uuid().nullable().optional(),
    contextKey: z.string().trim().max(80).optional(),
    contextValue: z.string().trim().max(160).optional(),
  })
  .refine((body) => Boolean(body.contextKey) === Boolean(body.contextValue), {
    message: "Enter both a context name and value, or leave both blank.",
  });

function entryFrom(row: CatalogRow | MappingRow): ToolClassificationEntry {
  const mapping = row as MappingRow;
  return {
    toolKind: row.tool_kind,
    toolKey: row.tool_key,
    displayName: row.display_name,
    classification: row.classification,
    ...(mapping.product_id === undefined ? {} : { productId: mapping.product_id }),
    ...(mapping.context_key === undefined
      ? {}
      : { contextKey: mapping.context_key, contextValue: mapping.context_value }),
  };
}

function mappingResponse(row: MappingRow) {
  return {
    id: row.id,
    toolKind: row.tool_kind,
    toolKey: row.tool_key,
    displayName: row.display_name,
    classification: row.classification,
    productId: row.product_id,
    productName: row.product_name ?? null,
    contextKey: row.context_key,
    contextValue: row.context_value,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mappingIdFrom(request: FastifyRequest): string | null {
  const parsed = z
    .string()
    .uuid()
    .safeParse((request.params as { mappingId?: string }).mappingId);
  return parsed.success ? parsed.data : null;
}

async function ensureOwnedProduct(
  productId: string | null | undefined,
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!productId) return true;
  try {
    const result = await pool.query(
      "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
      [productId, userId],
    );
    if (result.rowCount === 1) return true;
    reply.code(404).send({ error: "Product not found." });
  } catch (error) {
    request.log.error({ err: error }, "Could not verify product ownership for tool mapping");
    reply.code(503).send({ error: "Product ownership could not be verified." });
  }
  return false;
}

function validationError(error: unknown): string {
  return error instanceof Error ? error.message : "Enter a valid application or domain identifier.";
}

export async function registerClassificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/classification/catalog", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "classification:read", session.id, 120, 60))) return;
    const parsedQuery = z
      .object({ q: z.string().trim().max(100).optional(), kind: z.enum(TOOL_KINDS).optional() })
      .safeParse(request.query);
    if (!parsedQuery.success) return reply.code(400).send({ error: "Review the catalog filters." });
    const search = parsedQuery.data.q ?? "";
    const kind = parsedQuery.data.kind ?? null;
    try {
      const result = await pool.query<CatalogRow>(
        `SELECT tool_kind, tool_key, display_name, classification
         FROM enough.tool_classification_catalog
         WHERE ($1::text IS NULL OR tool_kind = $1)
           AND ($2::text = '' OR display_name ILIKE '%' || $2 || '%' OR tool_key ILIKE '%' || $2 || '%')
         ORDER BY tool_kind, display_name
         LIMIT 250`,
        [kind, search],
      );
      return reply.send({
        catalog: result.rows.map((row) => ({
          toolKind: row.tool_kind,
          toolKey: row.tool_key,
          displayName: row.display_name,
          classification: row.classification,
        })),
      });
    } catch (error) {
      request.log.error({ err: error }, "Could not load tool catalog");
      return reply.code(503).send({ error: "The tool catalog is temporarily unavailable." });
    }
  });

  app.get("/classification/mappings", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "classification:read", session.id, 120, 60))) return;
    try {
      const result = await pool.query<MappingRow>(
        `SELECT mapping.*, product.name AS product_name
         FROM enough.tool_classification_mappings mapping
         LEFT JOIN enough.products product ON product.id = mapping.product_id AND product.user_id = mapping.user_id
         WHERE mapping.user_id = $1
         ORDER BY mapping.tool_kind, mapping.display_name, mapping.product_id NULLS FIRST, mapping.context_key`,
        [session.id],
      );
      return reply.send({ mappings: result.rows.map(mappingResponse) });
    } catch (error) {
      request.log.error({ err: error }, "Could not load tool mappings");
      return reply.code(503).send({ error: "Your tool mappings are temporarily unavailable." });
    }
  });

  app.post("/classification/mappings", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "classification:write", session.id, 120, 60 * 60)))
      return;
    const parsed = mappingSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the mapping details." });
    const body = parsed.data;
    let toolKey: string;
    try {
      toolKey = normalizeToolKey(body.toolKind, body.toolKey);
    } catch (error) {
      return reply.code(400).send({ error: validationError(error) });
    }
    if (!(await ensureOwnedProduct(body.productId, session.id, request, reply))) return;
    try {
      const inserted = await pool.query<MappingRow>(
        `WITH inserted AS (
           INSERT INTO enough.tool_classification_mappings
             (id, user_id, product_id, tool_kind, tool_key, display_name, classification, context_key, context_value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *
         )
         SELECT inserted.*, product.name AS product_name
         FROM inserted
         LEFT JOIN enough.products product ON product.id = inserted.product_id AND product.user_id = inserted.user_id`,
        [
          randomUUID(),
          session.id,
          body.productId ?? null,
          body.toolKind,
          toolKey,
          body.displayName,
          body.classification,
          body.contextKey?.toLocaleLowerCase("en-US") ?? "",
          body.contextValue?.toLocaleLowerCase("en-US") ?? "",
        ],
      );
      const row = inserted.rows[0];
      return reply.code(201).send({ mapping: mappingResponse(row) });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505")
        return reply
          .code(409)
          .send({ error: "A mapping already exists for this tool, scope, and context." });
      request.log.error({ err: error }, "Could not create tool mapping");
      return reply.code(503).send({ error: "The tool mapping could not be saved." });
    }
  });

  app.patch("/classification/mappings/:mappingId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "classification:write", session.id, 120, 60 * 60)))
      return;
    const mappingId = mappingIdFrom(request);
    if (!mappingId) return reply.code(400).send({ error: "Invalid mapping ID." });
    const parsed = mappingSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the mapping details." });
    const body = parsed.data;
    let toolKey: string;
    try {
      toolKey = normalizeToolKey(body.toolKind, body.toolKey);
    } catch (error) {
      return reply.code(400).send({ error: validationError(error) });
    }
    if (!(await ensureOwnedProduct(body.productId, session.id, request, reply))) return;
    try {
      const updated = await pool.query<MappingRow>(
        `WITH updated AS (
           UPDATE enough.tool_classification_mappings
           SET product_id = $3, tool_kind = $4, tool_key = $5, display_name = $6, classification = $7,
               context_key = $8, context_value = $9, updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING *
         )
         SELECT updated.*, product.name AS product_name
         FROM updated
         LEFT JOIN enough.products product ON product.id = updated.product_id AND product.user_id = updated.user_id`,
        [
          mappingId,
          session.id,
          body.productId ?? null,
          body.toolKind,
          toolKey,
          body.displayName,
          body.classification,
          body.contextKey?.toLocaleLowerCase("en-US") ?? "",
          body.contextValue?.toLocaleLowerCase("en-US") ?? "",
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "Mapping not found." });
      const row = updated.rows[0];
      return reply.send({ mapping: mappingResponse(row) });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505")
        return reply
          .code(409)
          .send({ error: "A mapping already exists for this tool, scope, and context." });
      request.log.error({ err: error }, "Could not update tool mapping");
      return reply.code(503).send({ error: "The tool mapping could not be updated." });
    }
  });

  app.delete("/classification/mappings/:mappingId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "classification:write", session.id, 120, 60 * 60)))
      return;
    const mappingId = mappingIdFrom(request);
    if (!mappingId) return reply.code(400).send({ error: "Invalid mapping ID." });
    try {
      const result = await pool.query(
        "DELETE FROM enough.tool_classification_mappings WHERE id = $1 AND user_id = $2",
        [mappingId, session.id],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Mapping not found." });
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error }, "Could not delete tool mapping");
      return reply.code(503).send({ error: "The tool mapping could not be deleted." });
    }
  });

  app.post("/classification/resolve", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "classification:resolve", session.id, 120, 60)))
      return;
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Review the tool details." });
    const body = parsed.data;
    let toolKey: string;
    try {
      toolKey = normalizeToolKey(body.toolKind, body.toolKey);
    } catch (error) {
      return reply.code(400).send({ error: validationError(error) });
    }
    if (!(await ensureOwnedProduct(body.productId, session.id, request, reply))) return;
    try {
      const [mappingResult, catalogResult] = await Promise.all([
        pool.query<MappingRow>(
          `SELECT * FROM enough.tool_classification_mappings
           WHERE user_id = $1 AND (product_id IS NULL OR product_id = $2)`,
          [session.id, body.productId ?? null],
        ),
        pool.query<CatalogRow>(
          "SELECT tool_kind, tool_key, display_name, classification FROM enough.tool_classification_catalog",
        ),
      ]);
      const resolution = resolveToolClassification(
        { ...body, toolKey },
        mappingResult.rows.map(entryFrom),
        catalogResult.rows.map(entryFrom),
      );
      return reply.send({ resolution });
    } catch (error) {
      request.log.error({ err: error }, "Could not resolve tool classification");
      return reply.code(503).send({ error: "The tool classification could not be resolved." });
    }
  });
}

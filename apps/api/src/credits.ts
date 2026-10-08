import { createHash, randomUUID } from "node:crypto";
import { checkRateLimit } from "@enough/auth";
import { type DbClient, pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";

const MAX_CREDIT_AMOUNT = 1_000_000_000;
const amountSchema = z.number().int().positive().max(MAX_CREDIT_AMOUNT);
const idempotencySchema = z.string().trim().min(8).max(120);
const productScope = { productId: z.string().uuid().nullable().optional() };
const earnSchema = z
  .object({
    ...productScope,
    amount: amountSchema,
    idempotencyKey: idempotencySchema,
    expiresAt: z.string().datetime().optional(),
    reason: z.string().trim().min(2).max(300).optional(),
  })
  .strict();
const spendSchema = z
  .object({
    ...productScope,
    amount: amountSchema,
    idempotencyKey: idempotencySchema,
    reason: z.string().trim().min(2).max(300).optional(),
  })
  .strict();
const reserveSchema = z
  .object({
    ...productScope,
    amount: amountSchema,
    idempotencyKey: idempotencySchema,
    expiresAt: z.string().datetime().optional(),
    reason: z.string().trim().min(2).max(300).optional(),
  })
  .strict();
const reservationActionSchema = z
  .object({ ...productScope, idempotencyKey: idempotencySchema })
  .strict();
const refundSchema = z
  .object({
    ...productScope,
    transactionId: z.string().uuid(),
    amount: amountSchema,
    idempotencyKey: idempotencySchema,
    reason: z.string().trim().min(2).max(300).optional(),
  })
  .strict();
const adjustSchema = z
  .object({
    ...productScope,
    direction: z.enum(["CREDIT", "DEBIT"]),
    amount: amountSchema,
    idempotencyKey: idempotencySchema,
    expiresAt: z.string().datetime().optional(),
    reason: z.string().trim().min(2).max(300),
  })
  .strict()
  .refine((body) => body.direction === "CREDIT" || !body.expiresAt, {
    message: "Only credit adjustments can have an expiration.",
  });
const expireSchema = z.object({ ...productScope, idempotencyKey: idempotencySchema }).strict();

interface AccountRow {
  id: string;
  user_id: string;
  product_id: string | null;
  available_balance: string;
  reserved_balance: string;
  lifetime_earned: string;
  lifetime_spent: string;
  created_at: Date;
  updated_at: Date;
}

interface TransactionRow {
  id: string;
  action: string;
  amount: string;
  available_delta: string;
  reserved_delta: string;
  balance_after_available: string;
  balance_after_reserved: string;
  idempotency_key: string;
  request_hash: string;
  reservation_id: string | null;
  related_transaction_id: string | null;
  refunded_amount: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface LotRow {
  id: string;
  available_amount: string;
  reserved_amount: string;
  expires_at: Date | null;
}

interface ReservationRow {
  id: string;
  status: "ACTIVE" | "RELEASED" | "SPENT" | "EXPIRED";
  amount: string;
  remaining_amount: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

class CreditError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Credit balance exceeds the supported range.");
  return parsed;
};

const digest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex");

function accountResponse(row: AccountRow) {
  return {
    id: row.id,
    productId: row.product_id,
    availableBalance: integer(row.available_balance),
    reservedBalance: integer(row.reserved_balance),
    lifetimeEarned: integer(row.lifetime_earned),
    lifetimeSpent: integer(row.lifetime_spent),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function transactionResponse(row: TransactionRow) {
  return {
    id: row.id,
    action: row.action,
    amount: integer(row.amount),
    availableDelta: integer(row.available_delta),
    reservedDelta: integer(row.reserved_delta),
    balanceAfterAvailable: integer(row.balance_after_available),
    balanceAfterReserved: integer(row.balance_after_reserved),
    idempotencyKey: row.idempotency_key,
    reservationId: row.reservation_id,
    relatedTransactionId: row.related_transaction_id,
    refundedAmount: integer(row.refunded_amount),
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

async function ownedAccount(
  client: DbClient,
  userId: string,
  productId: string | null | undefined,
): Promise<AccountRow> {
  if (productId) {
    const product = await client.query(
      "SELECT 1 FROM enough.products WHERE id = $1 AND user_id = $2",
      [productId, userId],
    );
    if (product.rowCount !== 1) throw new CreditError(404, "Product not found.");
    await client.query(
      `INSERT INTO enough.credit_accounts (id, user_id, product_id)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, product_id) WHERE product_id IS NOT NULL DO NOTHING`,
      [randomUUID(), userId, productId],
    );
  } else {
    await client.query(
      `INSERT INTO enough.credit_accounts (id, user_id, product_id)
       VALUES ($1, $2, NULL) ON CONFLICT (user_id) WHERE product_id IS NULL DO NOTHING`,
      [randomUUID(), userId],
    );
  }
  const result = await client.query<AccountRow>(
    `SELECT id, user_id, product_id, available_balance::text, reserved_balance::text,
            lifetime_earned::text, lifetime_spent::text, created_at, updated_at
     FROM enough.credit_accounts
     WHERE user_id = $1 AND product_id IS NOT DISTINCT FROM $2
     FOR UPDATE`,
    [userId, productId ?? null],
  );
  if (!result.rows[0]) throw new CreditError(503, "The credit account could not be loaded.");
  return result.rows[0];
}

async function writeTransaction(
  client: DbClient,
  input: {
    account: AccountRow;
    deviceId: string | null;
    action: string;
    amount: number;
    availableDelta: number;
    reservedDelta: number;
    idempotencyKey: string;
    requestHash: string;
    reservationId?: string | null;
    relatedTransactionId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<TransactionRow> {
  const current = await client.query<AccountRow>(
    `SELECT id, user_id, product_id, available_balance::text, reserved_balance::text,
            lifetime_earned::text, lifetime_spent::text, created_at, updated_at
     FROM enough.credit_accounts WHERE id = $1`,
    [input.account.id],
  );
  const row = current.rows[0];
  if (!row) throw new CreditError(503, "The credit account could not be loaded.");
  const inserted = await client.query<TransactionRow>(
    `INSERT INTO enough.credit_transactions
       (id, account_id, user_id, device_id, action, amount, available_delta, reserved_delta,
        balance_after_available, balance_after_reserved, idempotency_key, request_hash,
        reservation_id, related_transaction_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     RETURNING id, action, amount::text, available_delta::text, reserved_delta::text,
               balance_after_available::text, balance_after_reserved::text, idempotency_key,
               reservation_id, related_transaction_id, refunded_amount::text, metadata, created_at`,
    [
      randomUUID(),
      input.account.id,
      input.account.user_id,
      input.deviceId,
      input.action,
      input.amount,
      input.availableDelta,
      input.reservedDelta,
      row.available_balance,
      row.reserved_balance,
      input.idempotencyKey,
      input.requestHash,
      input.reservationId ?? null,
      input.relatedTransactionId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return inserted.rows[0];
}

async function expireAccount(
  client: DbClient,
  account: AccountRow,
  deviceId: string | null,
  idempotencyKey?: string,
  requestHash?: string,
): Promise<TransactionRow | null> {
  const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  const now = clock.rows[0].now;
  const expiredLots = await client.query<LotRow>(
    `SELECT id, available_amount::text, reserved_amount::text, expires_at
     FROM enough.credit_lots
     WHERE account_id = $1 AND expires_at <= $2 AND (available_amount > 0 OR reserved_amount > 0)
     ORDER BY expires_at, created_at, id FOR UPDATE`,
    [account.id, now],
  );

  let expiredAvailable = 0;
  let expiredReserved = 0;
  const expiredByReservation = new Map<string, number>();
  for (const lot of expiredLots.rows) {
    expiredAvailable += integer(lot.available_amount);
    expiredReserved += integer(lot.reserved_amount);
    const allocations = await client.query<{ reservation_id: string; amount: string }>(
      `UPDATE enough.credit_reservation_allocations
       SET status = 'EXPIRED'
       WHERE lot_id = $1 AND status = 'ACTIVE'
       RETURNING reservation_id, amount::text`,
      [lot.id],
    );
    for (const allocation of allocations.rows) {
      expiredByReservation.set(
        allocation.reservation_id,
        (expiredByReservation.get(allocation.reservation_id) ?? 0) + integer(allocation.amount),
      );
    }
    await client.query(
      "UPDATE enough.credit_lots SET available_amount = 0, reserved_amount = 0 WHERE id = $1",
      [lot.id],
    );
  }
  for (const [reservationId, amount] of expiredByReservation) {
    await client.query(
      `UPDATE enough.credit_reservations
       SET remaining_amount = GREATEST(remaining_amount - $2, 0),
           status = CASE WHEN remaining_amount - $2 <= 0 THEN 'EXPIRED' ELSE status END,
           updated_at = $3
       WHERE id = $1 AND status = 'ACTIVE'`,
      [reservationId, amount, now],
    );
  }

  let releasedFromExpiredReservations = 0;
  let returnedAvailable = 0;
  const expiredReservations = await client.query<ReservationRow>(
    `SELECT id, status, amount::text, remaining_amount::text, expires_at, created_at, updated_at
     FROM enough.credit_reservations
     WHERE account_id = $1 AND status = 'ACTIVE' AND expires_at <= $2
     ORDER BY expires_at, id FOR UPDATE`,
    [account.id, now],
  );
  for (const reservation of expiredReservations.rows) {
    const allocations = await client.query<{
      id: string;
      lot_id: string;
      amount: string;
      expires_at: Date | null;
    }>(
      `SELECT allocation.id, allocation.lot_id, allocation.amount::text, lot.expires_at
       FROM enough.credit_reservation_allocations allocation
       JOIN enough.credit_lots lot ON lot.id = allocation.lot_id
       WHERE allocation.reservation_id = $1 AND allocation.status = 'ACTIVE'
       ORDER BY lot.expires_at ASC NULLS LAST, lot.created_at, lot.id
       FOR UPDATE OF allocation, lot`,
      [reservation.id],
    );
    let reservationRelease = 0;
    for (const allocation of allocations.rows) {
      const amount = integer(allocation.amount);
      const stillValid = allocation.expires_at === null || allocation.expires_at > now;
      if (stillValid) {
        await client.query(
          `UPDATE enough.credit_lots
           SET available_amount = available_amount + $2, reserved_amount = reserved_amount - $2
           WHERE id = $1`,
          [allocation.lot_id, amount],
        );
        returnedAvailable += amount;
      }
      await client.query(
        "UPDATE enough.credit_reservation_allocations SET status = $2 WHERE id = $1",
        [allocation.id, stillValid ? "RELEASED" : "EXPIRED"],
      );
      reservationRelease += amount;
    }
    releasedFromExpiredReservations += reservationRelease;
    await client.query(
      `UPDATE enough.credit_reservations
       SET remaining_amount = 0, status = 'EXPIRED', updated_at = $2 WHERE id = $1`,
      [reservation.id, now],
    );
  }

  const availableDelta = -expiredAvailable + returnedAvailable;
  const reservedDelta = -expiredReserved - releasedFromExpiredReservations;
  const expiredAmount = expiredAvailable + expiredReserved + releasedFromExpiredReservations;
  if (availableDelta !== 0 || reservedDelta !== 0 || idempotencyKey) {
    await client.query(
      `UPDATE enough.credit_accounts
       SET available_balance = available_balance + $2,
           reserved_balance = reserved_balance + $3,
           updated_at = $4
       WHERE id = $1`,
      [account.id, availableDelta, reservedDelta, now],
    );
  }
  if (expiredAmount === 0 && !idempotencyKey) return null;
  const key = idempotencyKey ?? randomUUID();
  return writeTransaction(client, {
    account,
    deviceId,
    action: "EXPIRE",
    amount: expiredAmount,
    availableDelta,
    reservedDelta,
    idempotencyKey: key,
    requestHash:
      requestHash ??
      digest({ action: "automatic_expiration", at: now.toISOString(), accountId: account.id }),
    metadata: {
      expiredAvailable,
      expiredReserved,
      releasedFromExpiredReservations,
      returnedAvailable,
    },
  });
}

async function takeAvailable(
  client: DbClient,
  accountId: string,
  amount: number,
  reserve: boolean,
  now: Date,
): Promise<Array<{ lotId: string; amount: number }>> {
  const lots = await client.query<LotRow>(
    `SELECT id, available_amount::text, reserved_amount::text, expires_at
     FROM enough.credit_lots
     WHERE account_id = $1 AND available_amount > 0 AND (expires_at IS NULL OR expires_at > $2)
     ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC FOR UPDATE`,
    [accountId, now],
  );
  let remaining = amount;
  const allocations: Array<{ lotId: string; amount: number }> = [];
  for (const lot of lots.rows) {
    if (remaining === 0) break;
    const take = Math.min(integer(lot.available_amount), remaining);
    await client.query(
      `UPDATE enough.credit_lots
       SET available_amount = available_amount - $2,
           reserved_amount = reserved_amount + CASE WHEN $3 THEN $2 ELSE 0 END
       WHERE id = $1`,
      [lot.id, take, reserve],
    );
    allocations.push({ lotId: lot.id, amount: take });
    remaining -= take;
  }
  if (remaining !== 0)
    throw new CreditError(409, "There are not enough unexpired available credits.");
  return allocations;
}

async function reservationForAccount(
  client: DbClient,
  accountId: string,
  userId: string,
  reservationId: string,
): Promise<ReservationRow> {
  const result = await client.query<ReservationRow>(
    `SELECT id, status, amount::text, remaining_amount::text, expires_at, created_at, updated_at
     FROM enough.credit_reservations WHERE id = $1 AND account_id = $2 AND user_id = $3 FOR UPDATE`,
    [reservationId, accountId, userId],
  );
  if (!result.rows[0]) throw new CreditError(404, "Credit reservation not found.");
  if (result.rows[0].status !== "ACTIVE")
    throw new CreditError(409, "This credit reservation is no longer active.");
  return result.rows[0];
}

async function reserveTransaction(client: DbClient, account: AccountRow, reservationId: string) {
  const result = await client.query<TransactionRow>(
    `SELECT id, action, amount::text, available_delta::text, reserved_delta::text,
            balance_after_available::text, balance_after_reserved::text, idempotency_key,
            reservation_id, related_transaction_id, refunded_amount::text, metadata, created_at
     FROM enough.credit_transactions WHERE account_id = $1 AND reservation_id = $2 AND action = 'RESERVE'
     ORDER BY created_at ASC LIMIT 1`,
    [account.id, reservationId],
  );
  return result.rows[0]?.id ?? null;
}

async function runMutation(
  userId: string,
  deviceId: string | null,
  productId: string | null | undefined,
  idempotencyKey: string,
  requestHash: string,
  operation: (
    client: DbClient,
    account: AccountRow,
    now: Date,
  ) => Promise<{ transaction: TransactionRow; reservation?: ReservationRow }>,
  options: { expireFirst?: boolean } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await ownedAccount(client, userId, productId);
    const prior = await client.query<TransactionRow>(
      `SELECT id, action, amount::text, available_delta::text, reserved_delta::text,
              balance_after_available::text, balance_after_reserved::text, idempotency_key,
              request_hash, reservation_id, related_transaction_id, refunded_amount::text, metadata, created_at
       FROM enough.credit_transactions WHERE account_id = $1 AND idempotency_key = $2`,
      [account.id, idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash)
        throw new CreditError(
          409,
          "This idempotency key was already used for a different credit request.",
        );
      const reservation = prior.rows[0].reservation_id
        ? await client.query<ReservationRow>(
            `SELECT id, status, amount::text, remaining_amount::text, expires_at, created_at, updated_at
           FROM enough.credit_reservations WHERE id = $1`,
            [prior.rows[0].reservation_id],
          )
        : null;
      await client.query("COMMIT");
      return {
        account: accountResponse(account),
        transaction: transactionResponse(prior.rows[0]),
        reservation: reservation?.rows[0] ? reservationResponse(reservation.rows[0]) : undefined,
        replayed: true,
      };
    }
    if (options.expireFirst !== false) {
      await expireAccount(client, account, deviceId);
    }
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const result = await operation(client, account, clock.rows[0].now);
    const current = await client.query<AccountRow>(
      `SELECT id, user_id, product_id, available_balance::text, reserved_balance::text,
              lifetime_earned::text, lifetime_spent::text, created_at, updated_at
       FROM enough.credit_accounts WHERE id = $1`,
      [account.id],
    );
    await client.query("COMMIT");
    return {
      account: accountResponse(current.rows[0]),
      transaction: transactionResponse(result.transaction),
      ...(result.reservation ? { reservation: reservationResponse(result.reservation) } : {}),
      replayed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function reservationResponse(row: ReservationRow) {
  return {
    id: row.id,
    status: row.status,
    amount: integer(row.amount),
    remainingAmount: integer(row.remaining_amount),
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function sendCreditError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof CreditError)
    return reply.code(error.statusCode).send({ error: error.message });
  request.log.error({ err: error }, "Credit operation failed");
  return reply.code(503).send({ error: "The credit operation could not be completed." });
}

function bodyError(reply: FastifyReply, error: string) {
  return reply.code(400).send({ error });
}

async function allowCreditWrite(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  grantsCredits = false,
): Promise<boolean> {
  if (!(await checkRateLimit(request, reply, "credits:write", userId, 120, 60))) return false;
  if (
    grantsCredits &&
    !(await checkRateLimit(request, reply, "credits:grant", userId, 10, 60 * 60))
  )
    return false;
  return true;
}

async function validateExpiration(value: string | undefined, now: Date): Promise<Date | null> {
  if (!value) return null;
  const expiry = new Date(value);
  if (expiry <= now || expiry.getTime() - now.getTime() > 365 * 24 * 60 * 60 * 1000) {
    throw new CreditError(400, "Credit expiration must be in the future and within one year.");
  }
  return expiry;
}

async function createGrant(
  client: DbClient,
  account: AccountRow,
  deviceId: string | null,
  amount: number,
  expiresAt: Date | null,
  action: "EARN" | "ADJUST",
  idempotencyKey: string,
  requestHash: string,
  reason: string | undefined,
  extraMetadata: Record<string, unknown> = {},
) {
  await client.query(
    `UPDATE enough.credit_accounts
     SET available_balance = available_balance + $2,
         lifetime_earned = lifetime_earned + CASE WHEN $3 = 'EARN' THEN $2 ELSE 0 END,
         updated_at = now()
     WHERE id = $1`,
    [account.id, amount, action],
  );
  const transaction = await writeTransaction(client, {
    account,
    deviceId,
    action,
    amount,
    availableDelta: amount,
    reservedDelta: 0,
    idempotencyKey,
    requestHash,
    metadata: { reason: reason ?? null, direction: "CREDIT", ...extraMetadata },
  });
  await client.query(
    `INSERT INTO enough.credit_lots
       (id, account_id, user_id, source_transaction_id, original_amount, available_amount, reserved_amount, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, 0, $6)`,
    [randomUUID(), account.id, account.user_id, transaction.id, amount, expiresAt],
  );
  return transaction;
}

/**
 * Adds a reviewed task reward inside the caller's open database transaction.
 * Keeping this in the credit engine preserves the normal wallet lock, lot, and ledger rules.
 */
export async function grantVerifiedTaskRewardInTransaction(
  client: DbClient,
  input: {
    userId: string;
    deviceId: string | null;
    productId: string;
    taskId: string;
    completionId: string;
    evidenceId: string;
    amount: number;
    verificationMethod: "MANUAL" | "AUTOMATIC";
  },
): Promise<string | null> {
  if (input.amount === 0) return null;
  const account = await ownedAccount(client, input.userId, input.productId);
  const idempotencyKey = `taskreward:${input.completionId}`;
  const requestHash = digest({
    action: "VERIFIED_TASK_REWARD",
    productId: input.productId,
    taskId: input.taskId,
    completionId: input.completionId,
    evidenceId: input.evidenceId,
    amount: input.amount,
    verificationMethod: input.verificationMethod,
  });
  const prior = await client.query<{ id: string; request_hash: string }>(
    `SELECT id, request_hash FROM enough.credit_transactions
     WHERE account_id = $1 AND idempotency_key = $2`,
    [account.id, idempotencyKey],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      throw new CreditError(409, "This task reward was already issued with different details.");
    }
    return prior.rows[0].id;
  }
  await expireAccount(client, account, input.deviceId);
  const transaction = await createGrant(
    client,
    account,
    input.deviceId,
    input.amount,
    null,
    "EARN",
    idempotencyKey,
    requestHash,
    input.verificationMethod === "AUTOMATIC"
      ? "Automatically verified integration event"
      : "Manually verified task evidence",
    {
      taskId: input.taskId,
      completionId: input.completionId,
      evidenceId: input.evidenceId,
      verificationStatus:
        input.verificationMethod === "AUTOMATIC" ? "AUTOMATICALLY_VERIFIED" : "VERIFIED",
      verificationMethod: input.verificationMethod,
    },
  );
  return transaction.id;
}

export async function registerCreditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/credits", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!(await checkRateLimit(request, reply, "credits:read", session.id, 60, 60))) return;
    const parsedQuery = z
      .object({ productId: z.string().uuid().optional() })
      .strict()
      .safeParse(request.query);
    if (!parsedQuery.success) return bodyError(reply, "Invalid product scope.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const account = await ownedAccount(client, session.id, parsedQuery.data.productId);
      await expireAccount(client, account, session.deviceId);
      const [current, transactions, reservations] = await Promise.all([
        client.query<AccountRow>(
          `SELECT id, user_id, product_id, available_balance::text, reserved_balance::text,
                  lifetime_earned::text, lifetime_spent::text, created_at, updated_at
           FROM enough.credit_accounts WHERE id = $1`,
          [account.id],
        ),
        client.query<TransactionRow>(
          `SELECT id, action, amount::text, available_delta::text, reserved_delta::text,
                  balance_after_available::text, balance_after_reserved::text, idempotency_key,
                  reservation_id, related_transaction_id, refunded_amount::text, metadata, created_at
           FROM enough.credit_transactions WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
          [account.id],
        ),
        client.query<ReservationRow>(
          `SELECT id, status, amount::text, remaining_amount::text, expires_at, created_at, updated_at
           FROM enough.credit_reservations WHERE account_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [account.id],
        ),
      ]);
      await client.query("COMMIT");
      return reply.send({
        account: accountResponse(current.rows[0]),
        transactions: transactions.rows.map(transactionResponse),
        reservations: reservations.rows.map(reservationResponse),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendCreditError(request, reply, error);
    } finally {
      client.release();
    }
  });

  app.post("/credits/earn", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id, true))
    )
      return;
    const parsed = earnSchema.safeParse(request.body);
    if (!parsed.success)
      return bodyError(reply, parsed.error.issues[0]?.message ?? "Review the credit grant.");
    const body = parsed.data;
    const hash = digest({
      action: "EARN",
      productId: body.productId ?? null,
      amount: body.amount,
      expiresAt: body.expiresAt ?? null,
      reason: body.reason ?? null,
    });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account, now) => ({
          transaction: await createGrant(
            client,
            account,
            session.deviceId,
            body.amount,
            await validateExpiration(body.expiresAt, now),
            "EARN",
            body.idempotencyKey,
            hash,
            body.reason,
          ),
        }),
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });

  app.post("/credits/spend", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id))
    )
      return;
    const parsed = spendSchema.safeParse(request.body);
    if (!parsed.success)
      return bodyError(reply, parsed.error.issues[0]?.message ?? "Review the spend request.");
    const body = parsed.data;
    const hash = digest({
      action: "SPEND",
      productId: body.productId ?? null,
      amount: body.amount,
      reason: body.reason ?? null,
    });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account, now) => {
          const allocations = await takeAvailable(client, account.id, body.amount, false, now);
          const updated = await client.query(
            `UPDATE enough.credit_accounts SET available_balance = available_balance - $2,
               lifetime_spent = lifetime_spent + $2, updated_at = now()
             WHERE id = $1 AND available_balance >= $2 RETURNING id`,
            [account.id, body.amount],
          );
          if (updated.rowCount !== 1)
            throw new CreditError(409, "There are not enough available credits.");
          const transaction = await writeTransaction(client, {
            account,
            deviceId: session.deviceId,
            action: "SPEND",
            amount: body.amount,
            availableDelta: -body.amount,
            reservedDelta: 0,
            idempotencyKey: body.idempotencyKey,
            requestHash: hash,
            metadata: { reason: body.reason ?? null },
          });
          for (const allocation of allocations) {
            await client.query(
              `INSERT INTO enough.credit_transaction_allocations
                 (id, transaction_id, lot_id, account_id, user_id, amount)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                randomUUID(),
                transaction.id,
                allocation.lotId,
                account.id,
                account.user_id,
                allocation.amount,
              ],
            );
          }
          return { transaction };
        },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });

  app.post("/credits/reserve", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id))
    )
      return;
    const parsed = reserveSchema.safeParse(request.body);
    if (!parsed.success)
      return bodyError(reply, parsed.error.issues[0]?.message ?? "Review the reservation.");
    const body = parsed.data;
    const hash = digest({
      action: "RESERVE",
      productId: body.productId ?? null,
      amount: body.amount,
      expiresAt: body.expiresAt ?? null,
      reason: body.reason ?? null,
    });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account, now) => {
          const expiresAt = await validateExpiration(body.expiresAt, now);
          const allocations = await takeAvailable(client, account.id, body.amount, true, now);
          const reservationId = randomUUID();
          const reservationResult = await client.query<ReservationRow>(
            `INSERT INTO enough.credit_reservations (id, account_id, user_id, status, amount, remaining_amount, expires_at)
             VALUES ($1, $2, $3, 'ACTIVE', $4, $4, $5)
             RETURNING id, status, amount::text, remaining_amount::text, expires_at, created_at, updated_at`,
            [reservationId, account.id, account.user_id, body.amount, expiresAt],
          );
          for (const allocation of allocations) {
            await client.query(
              `INSERT INTO enough.credit_reservation_allocations
                 (id, reservation_id, lot_id, account_id, user_id, amount, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
              [
                randomUUID(),
                reservationId,
                allocation.lotId,
                account.id,
                account.user_id,
                allocation.amount,
              ],
            );
          }
          await client.query(
            `UPDATE enough.credit_accounts SET available_balance = available_balance - $2,
               reserved_balance = reserved_balance + $2, updated_at = now() WHERE id = $1`,
            [account.id, body.amount],
          );
          const transaction = await writeTransaction(client, {
            account,
            deviceId: session.deviceId,
            action: "RESERVE",
            amount: body.amount,
            availableDelta: -body.amount,
            reservedDelta: body.amount,
            idempotencyKey: body.idempotencyKey,
            requestHash: hash,
            reservationId,
            metadata: { reason: body.reason ?? null },
          });
          return { transaction, reservation: reservationResult.rows[0] };
        },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });

  const reservationAction =
    (action: "RELEASE" | "SPEND") => async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await requireSession(request, reply);
      if (
        !session ||
        !requireCsrf(request, reply, session) ||
        !(await allowCreditWrite(request, reply, session.id))
      )
        return;
      const parsed = reservationActionSchema.safeParse(request.body);
      if (!parsed.success) return bodyError(reply, "Invalid reservation action.");
      const reservationId = z
        .string()
        .uuid()
        .safeParse((request.params as { reservationId?: string }).reservationId);
      if (!reservationId.success) return bodyError(reply, "Invalid reservation ID.");
      const body = parsed.data;
      const hash = digest({
        action,
        productId: body.productId ?? null,
        reservationId: reservationId.data,
      });
      try {
        const result = await runMutation(
          session.id,
          session.deviceId,
          body.productId,
          body.idempotencyKey,
          hash,
          async (client, account, now) => {
            const reservation = await reservationForAccount(
              client,
              account.id,
              session.id,
              reservationId.data,
            );
            const allocations = await client.query<{ id: string; lot_id: string; amount: string }>(
              `SELECT id, lot_id, amount::text FROM enough.credit_reservation_allocations
             WHERE reservation_id = $1 AND status = 'ACTIVE' ORDER BY lot_id FOR UPDATE`,
              [reservation.id],
            );
            const amount = integer(reservation.remaining_amount);
            for (const allocation of allocations.rows) {
              const portion = integer(allocation.amount);
              if (action === "RELEASE") {
                await client.query(
                  `UPDATE enough.credit_lots SET available_amount = available_amount + $2,
                   reserved_amount = reserved_amount - $2 WHERE id = $1`,
                  [allocation.lot_id, portion],
                );
              } else {
                await client.query(
                  "UPDATE enough.credit_lots SET reserved_amount = reserved_amount - $2 WHERE id = $1",
                  [allocation.lot_id, portion],
                );
              }
              await client.query(
                "UPDATE enough.credit_reservation_allocations SET status = $2 WHERE id = $1",
                [allocation.id, action === "RELEASE" ? "RELEASED" : "SPENT"],
              );
            }
            await client.query(
              `UPDATE enough.credit_reservations SET status = $2, remaining_amount = 0, updated_at = $3 WHERE id = $1`,
              [reservation.id, action === "RELEASE" ? "RELEASED" : "SPENT", now],
            );
            await client.query(
              `UPDATE enough.credit_accounts SET available_balance = available_balance + $2,
               reserved_balance = reserved_balance - $3,
               lifetime_spent = lifetime_spent + CASE WHEN $4 = 'SPEND' THEN $3 ELSE 0 END,
               updated_at = now() WHERE id = $1`,
              [account.id, action === "RELEASE" ? amount : 0, amount, action],
            );
            const transaction = await writeTransaction(client, {
              account,
              deviceId: session.deviceId,
              action,
              amount,
              availableDelta: action === "RELEASE" ? amount : 0,
              reservedDelta: -amount,
              idempotencyKey: body.idempotencyKey,
              requestHash: hash,
              reservationId: reservation.id,
              relatedTransactionId: await reserveTransaction(client, account, reservation.id),
            });
            if (action === "SPEND") {
              for (const allocation of allocations.rows) {
                await client.query(
                  `INSERT INTO enough.credit_transaction_allocations
                   (id, transaction_id, lot_id, account_id, user_id, amount)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                  [
                    randomUUID(),
                    transaction.id,
                    allocation.lot_id,
                    account.id,
                    account.user_id,
                    integer(allocation.amount),
                  ],
                );
              }
            }
            return { transaction };
          },
        );
        return reply.code(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return sendCreditError(request, reply, error);
      }
    };

  app.post("/credits/reservations/:reservationId/release", reservationAction("RELEASE"));
  app.post("/credits/reservations/:reservationId/spend", reservationAction("SPEND"));

  app.post("/credits/refund", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id))
    )
      return;
    const parsed = refundSchema.safeParse(request.body);
    if (!parsed.success)
      return bodyError(reply, parsed.error.issues[0]?.message ?? "Review the refund request.");
    const body = parsed.data;
    const hash = digest({
      action: "REFUND",
      productId: body.productId ?? null,
      transactionId: body.transactionId,
      amount: body.amount,
      reason: body.reason ?? null,
    });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account, now) => {
          const parentResult = await client.query<TransactionRow>(
            `SELECT id, action, amount::text, available_delta::text, reserved_delta::text,
                    balance_after_available::text, balance_after_reserved::text, idempotency_key,
                    reservation_id, related_transaction_id, refunded_amount::text, metadata, created_at
             FROM enough.credit_transactions WHERE id = $1 AND account_id = $2 FOR UPDATE`,
            [body.transactionId, account.id],
          );
          const parent = parentResult.rows[0];
          if (parent?.action !== "SPEND")
            throw new CreditError(404, "Spent credit transaction not found.");
          if (body.amount > integer(parent.amount) - integer(parent.refunded_amount)) {
            throw new CreditError(
              409,
              "The refund exceeds the amount that has not already been refunded.",
            );
          }
          const allocations = await client.query<{
            id: string;
            lot_id: string;
            amount: string;
            refunded_amount: string;
            expires_at: Date | null;
          }>(
            `SELECT allocation.id, allocation.lot_id, allocation.amount::text, allocation.refunded_amount::text, lot.expires_at
             FROM enough.credit_transaction_allocations allocation
             JOIN enough.credit_lots lot ON lot.id = allocation.lot_id
             WHERE allocation.transaction_id = $1
             ORDER BY lot.expires_at ASC NULLS LAST, allocation.created_at, allocation.id
             FOR UPDATE OF allocation, lot`,
            [parent.id],
          );
          let remaining = body.amount;
          let returned = 0;
          const refunds: Array<{ allocationId: string; amount: number }> = [];
          for (const allocation of allocations.rows) {
            if (remaining === 0) break;
            const capacity = integer(allocation.amount) - integer(allocation.refunded_amount);
            if (capacity <= 0) continue;
            const portion = Math.min(capacity, remaining);
            await client.query(
              "UPDATE enough.credit_transaction_allocations SET refunded_amount = refunded_amount + $2 WHERE id = $1",
              [allocation.id, portion],
            );
            if (allocation.expires_at === null || allocation.expires_at > now) {
              await client.query(
                "UPDATE enough.credit_lots SET available_amount = available_amount + $2 WHERE id = $1",
                [allocation.lot_id, portion],
              );
              returned += portion;
            }
            refunds.push({ allocationId: allocation.id, amount: portion });
            remaining -= portion;
          }
          if (remaining !== 0)
            throw new CreditError(
              409,
              "The refund exceeds the amount allocated by the original spend.",
            );
          await client.query(
            "UPDATE enough.credit_transactions SET refunded_amount = refunded_amount + $2 WHERE id = $1",
            [parent.id, body.amount],
          );
          if (returned)
            await client.query(
              "UPDATE enough.credit_accounts SET available_balance = available_balance + $2, updated_at = now() WHERE id = $1",
              [account.id, returned],
            );
          const transaction = await writeTransaction(client, {
            account,
            deviceId: session.deviceId,
            action: "REFUND",
            amount: body.amount,
            availableDelta: returned,
            reservedDelta: 0,
            idempotencyKey: body.idempotencyKey,
            requestHash: hash,
            relatedTransactionId: parent.id,
            metadata: { reason: body.reason ?? null, expiredAmount: body.amount - returned },
          });
          for (const refund of refunds) {
            await client.query(
              `INSERT INTO enough.credit_refund_allocations
                 (id, refund_transaction_id, source_allocation_id, account_id, user_id, amount)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                randomUUID(),
                transaction.id,
                refund.allocationId,
                account.id,
                account.user_id,
                refund.amount,
              ],
            );
          }
          return { transaction };
        },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });

  app.post("/credits/adjust", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id, true))
    )
      return;
    const parsed = adjustSchema.safeParse(request.body);
    if (!parsed.success)
      return bodyError(reply, parsed.error.issues[0]?.message ?? "Review the adjustment.");
    const body = parsed.data;
    const hash = digest({
      action: "ADJUST",
      productId: body.productId ?? null,
      direction: body.direction,
      amount: body.amount,
      expiresAt: body.expiresAt ?? null,
      reason: body.reason,
    });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account, now) => {
          if (body.direction === "CREDIT") {
            const transaction = await createGrant(
              client,
              account,
              session.deviceId,
              body.amount,
              await validateExpiration(body.expiresAt, now),
              "ADJUST",
              body.idempotencyKey,
              hash,
              body.reason,
            );
            return { transaction };
          }
          const allocations = await takeAvailable(client, account.id, body.amount, false, now);
          const updated = await client.query(
            `UPDATE enough.credit_accounts SET available_balance = available_balance - $2, updated_at = now()
             WHERE id = $1 AND available_balance >= $2 RETURNING id`,
            [account.id, body.amount],
          );
          if (updated.rowCount !== 1)
            throw new CreditError(409, "There are not enough available credits to adjust.");
          return {
            transaction: await writeTransaction(client, {
              account,
              deviceId: session.deviceId,
              action: "ADJUST",
              amount: body.amount,
              availableDelta: -body.amount,
              reservedDelta: 0,
              idempotencyKey: body.idempotencyKey,
              requestHash: hash,
              metadata: { direction: "DEBIT", reason: body.reason, allocations },
            }),
          };
        },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });

  app.post("/credits/expire", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !(await allowCreditWrite(request, reply, session.id))
    )
      return;
    const parsed = expireSchema.safeParse(request.body);
    if (!parsed.success) return bodyError(reply, "Invalid expiration request.");
    const body = parsed.data;
    const hash = digest({ action: "EXPIRE", productId: body.productId ?? null });
    try {
      const result = await runMutation(
        session.id,
        session.deviceId,
        body.productId,
        body.idempotencyKey,
        hash,
        async (client, account) => {
          const transaction = await expireAccount(
            client,
            account,
            session.deviceId,
            body.idempotencyKey,
            hash,
          );
          if (!transaction)
            throw new CreditError(503, "The expiration record could not be created.");
          return { transaction };
        },
        { expireFirst: false },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return sendCreditError(request, reply, error);
    }
  });
}

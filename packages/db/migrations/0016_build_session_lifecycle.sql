ALTER TABLE enough.credit_reservation_allocations
  ADD COLUMN remaining_amount bigint NOT NULL DEFAULT 0;

UPDATE enough.credit_reservation_allocations
SET remaining_amount = CASE WHEN status = 'ACTIVE' THEN amount ELSE 0 END;

ALTER TABLE enough.credit_reservation_allocations
  ADD CONSTRAINT credit_reservation_allocations_remaining_check
  CHECK (remaining_amount >= 0 AND remaining_amount <= amount AND
    ((status = 'ACTIVE' AND remaining_amount > 0) OR
     (status <> 'ACTIVE' AND remaining_amount = 0)));

CREATE TABLE enough.build_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  device_id uuid REFERENCES enough.auth_devices(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'EXHAUSTED', 'EXPIRED')),
  reserved_minutes integer NOT NULL CHECK (reserved_minutes BETWEEN 1 AND 60),
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0 AND active_seconds <= reserved_minutes * 60),
  lease_version integer NOT NULL DEFAULT 1 CHECK (lease_version > 0),
  last_heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (id, account_id, user_id),
  UNIQUE (reservation_id),
  FOREIGN KEY (account_id, user_id) REFERENCES enough.credit_accounts(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id, account_id, user_id)
    REFERENCES enough.credit_reservations(id, account_id, user_id) ON DELETE CASCADE,
  CHECK ((status IN ('ACTIVE', 'PAUSED') AND ended_at IS NULL) OR
         (status IN ('COMPLETED', 'EXHAUSTED', 'EXPIRED') AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX build_sessions_one_open_per_account_idx
  ON enough.build_sessions(account_id)
  WHERE status IN ('ACTIVE', 'PAUSED');
CREATE INDEX build_sessions_user_recent_idx
  ON enough.build_sessions(user_id, created_at DESC);
CREATE INDEX build_sessions_expiry_idx
  ON enough.build_sessions(account_id, expires_at)
  WHERE status IN ('ACTIVE', 'PAUSED');

CREATE TABLE enough.build_session_commands (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idempotency_key),
  FOREIGN KEY (session_id, account_id, user_id)
    REFERENCES enough.build_sessions(id, account_id, user_id) ON DELETE CASCADE
);

CREATE INDEX build_session_commands_user_recent_idx
  ON enough.build_session_commands(user_id, created_at DESC);

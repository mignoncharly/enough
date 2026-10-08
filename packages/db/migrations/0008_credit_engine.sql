CREATE TABLE enough.credit_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid,
  available_balance bigint NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  reserved_balance bigint NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  lifetime_earned bigint NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent bigint NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX credit_accounts_user_global_idx
  ON enough.credit_accounts(user_id) WHERE product_id IS NULL;
CREATE UNIQUE INDEX credit_accounts_user_product_idx
  ON enough.credit_accounts(user_id, product_id) WHERE product_id IS NOT NULL;

CREATE TABLE enough.credit_reservations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'SPENT', 'EXPIRED')),
  amount bigint NOT NULL CHECK (amount > 0),
  remaining_amount bigint NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES enough.credit_accounts(id, user_id) ON DELETE CASCADE,
  CHECK ((status = 'ACTIVE' AND remaining_amount > 0) OR
         (status <> 'ACTIVE' AND remaining_amount = 0))
);

CREATE INDEX credit_reservations_active_expiry_idx
  ON enough.credit_reservations(account_id, expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE enough.credit_transactions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid REFERENCES enough.auth_devices(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('EARN', 'SPEND', 'RESERVE', 'RELEASE', 'REFUND', 'EXPIRE', 'ADJUST')),
  amount bigint NOT NULL CHECK (amount > 0 OR action = 'EXPIRE'),
  available_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  balance_after_available bigint NOT NULL CHECK (balance_after_available >= 0),
  balance_after_reserved bigint NOT NULL CHECK (balance_after_reserved >= 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reservation_id uuid,
  related_transaction_id uuid,
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id, user_id),
  UNIQUE (account_id, idempotency_key),
  FOREIGN KEY (account_id, user_id) REFERENCES enough.credit_accounts(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id, account_id, user_id)
    REFERENCES enough.credit_reservations(id, account_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (related_transaction_id, account_id, user_id)
    REFERENCES enough.credit_transactions(id, account_id, user_id) ON DELETE CASCADE
);

CREATE INDEX credit_transactions_account_recent_idx
  ON enough.credit_transactions(account_id, created_at DESC, id DESC);

CREATE TABLE enough.credit_lots (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_transaction_id uuid NOT NULL,
  original_amount bigint NOT NULL CHECK (original_amount > 0),
  available_amount bigint NOT NULL CHECK (available_amount >= 0),
  reserved_amount bigint NOT NULL CHECK (reserved_amount >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES enough.credit_accounts(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (source_transaction_id, account_id, user_id)
    REFERENCES enough.credit_transactions(id, account_id, user_id) ON DELETE CASCADE,
  CHECK (available_amount + reserved_amount <= original_amount)
);

CREATE INDEX credit_lots_available_order_idx
  ON enough.credit_lots(account_id, expires_at ASC NULLS LAST, created_at ASC, id ASC)
  WHERE available_amount > 0;
CREATE INDEX credit_lots_expiry_idx
  ON enough.credit_lots(account_id, expires_at)
  WHERE expires_at IS NOT NULL AND (available_amount > 0 OR reserved_amount > 0);

CREATE TABLE enough.credit_reservation_allocations (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'SPENT', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, lot_id),
  FOREIGN KEY (reservation_id, account_id, user_id)
    REFERENCES enough.credit_reservations(id, account_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (lot_id, account_id, user_id)
    REFERENCES enough.credit_lots(id, account_id, user_id) ON DELETE CASCADE
);

CREATE INDEX credit_reservation_allocations_active_idx
  ON enough.credit_reservation_allocations(lot_id, reservation_id)
  WHERE status = 'ACTIVE';

CREATE TABLE enough.credit_transaction_allocations (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id, user_id),
  UNIQUE (transaction_id, lot_id),
  FOREIGN KEY (transaction_id, account_id, user_id)
    REFERENCES enough.credit_transactions(id, account_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (lot_id, account_id, user_id)
    REFERENCES enough.credit_lots(id, account_id, user_id) ON DELETE CASCADE
);

CREATE TABLE enough.credit_refund_allocations (
  id uuid PRIMARY KEY,
  refund_transaction_id uuid NOT NULL,
  source_allocation_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (refund_transaction_id, account_id, user_id)
    REFERENCES enough.credit_transactions(id, account_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (source_allocation_id, account_id, user_id)
    REFERENCES enough.credit_transaction_allocations(id, account_id, user_id) ON DELETE CASCADE
);

CREATE INDEX credit_refund_allocations_source_idx
  ON enough.credit_refund_allocations(source_allocation_id, created_at);

CREATE TABLE enough.billing_customers (
  user_id uuid PRIMARY KEY REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  trial_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.billing_subscriptions (
  stripe_subscription_id text PRIMARY KEY CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL REFERENCES enough.billing_customers(stripe_customer_id) ON DELETE CASCADE,
  stripe_price_id text NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan_key text NOT NULL CHECK (plan_key IN ('monthly', 'annual')),
  status text NOT NULL CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
  )),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  billing_interval text NOT NULL CHECK (billing_interval IN ('day', 'week', 'month', 'year')),
  unit_amount_minor bigint CHECK (unit_amount_minor IS NULL OR unit_amount_minor >= 0),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  grace_until timestamptz,
  latest_invoice_id text,
  latest_event_created_at timestamptz NOT NULL,
  latest_event_id text NOT NULL CHECK (latest_event_id ~ '^evt_[A-Za-z0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_subscription_id, user_id),
  CHECK (trial_end IS NULL OR trial_start IS NULL OR trial_end >= trial_start),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end >= current_period_start)
);

CREATE INDEX billing_subscriptions_user_recent_idx
  ON enough.billing_subscriptions(user_id, updated_at DESC);
CREATE INDEX billing_subscriptions_entitlement_idx
  ON enough.billing_subscriptions(user_id, status, current_period_end DESC);

CREATE TABLE enough.billing_entitlements (
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL CHECK (entitlement_key = 'paid_features'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'GRACE', 'INACTIVE')),
  source_subscription_id text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entitlement_key),
  CHECK ((status = 'GRACE' AND expires_at IS NOT NULL) OR status <> 'GRACE')
);

CREATE INDEX billing_entitlements_active_idx
  ON enough.billing_entitlements(user_id, entitlement_key)
  WHERE status IN ('ACTIVE', 'GRACE');

CREATE TABLE enough.billing_invoices (
  stripe_invoice_id text PRIMARY KEY CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL REFERENCES enough.billing_customers(stripe_customer_id) ON DELETE CASCADE,
  stripe_subscription_id text,
  invoice_number text,
  status text CHECK (status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  amount_due_minor bigint NOT NULL DEFAULT 0 CHECK (amount_due_minor >= 0),
  amount_paid_minor bigint NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  hosted_invoice_url text CHECK (hosted_invoice_url IS NULL OR hosted_invoice_url ~ '^https://'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_payment_error text CHECK (last_payment_error IS NULL OR char_length(last_payment_error) <= 500),
  stripe_created_at timestamptz NOT NULL,
  latest_event_created_at timestamptz NOT NULL,
  latest_event_id text NOT NULL CHECK (latest_event_id ~ '^evt_[A-Za-z0-9]+$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_invoices_user_recent_idx
  ON enough.billing_invoices(user_id, stripe_created_at DESC);

CREATE TABLE enough.billing_webhook_events (
  stripe_event_id text PRIMARY KEY CHECK (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  stripe_created_at timestamptz NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('PROCESSING', 'PROCESSED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX billing_webhook_events_created_idx
  ON enough.billing_webhook_events(stripe_created_at DESC);

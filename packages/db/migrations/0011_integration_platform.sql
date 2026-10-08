ALTER TABLE enough.growth_task_completions
  DROP CONSTRAINT growth_task_completions_verification_status_check,
  DROP CONSTRAINT growth_task_completions_review_state_check,
  ADD CONSTRAINT growth_task_completions_verification_status_check
    CHECK (verification_status IN (
      'SELF_REPORTED', 'AWAITING_EVIDENCE', 'AWAITING_REVIEW',
      'VERIFIED', 'AUTOMATICALLY_VERIFIED', 'REJECTED'
    )),
  ADD CONSTRAINT growth_task_completions_review_state_check
    CHECK (
      (verification_status IN ('VERIFIED', 'AUTOMATICALLY_VERIFIED', 'REJECTED') AND reviewed_at IS NOT NULL) OR
      (verification_status IN ('SELF_REPORTED', 'AWAITING_EVIDENCE', 'AWAITING_REVIEW') AND reviewed_at IS NULL)
    );

ALTER TABLE enough.task_evidence_items
  ADD COLUMN verification_method text NOT NULL DEFAULT 'MANUAL'
    CHECK (verification_method IN ('MANUAL', 'AUTOMATIC'));

CREATE TABLE enough.integration_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN (
    'GMAIL', 'GOOGLE_CALENDAR', 'OUTLOOK', 'MICROSOFT_CALENDAR', 'STRIPE',
    'POSTHOG', 'PLAUSIBLE', 'GA4', 'WEBHOOK', 'PUBLIC_API'
  )),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 100),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ERROR', 'REVOKED')),
  api_key_hash bytea UNIQUE,
  signing_secret_ciphertext bytea,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, product_id, user_id),
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  CHECK (
    (provider IN ('WEBHOOK', 'PUBLIC_API') AND
      ((status IN ('ACTIVE', 'ERROR') AND api_key_hash IS NOT NULL AND signing_secret_ciphertext IS NOT NULL) OR
       (status = 'REVOKED' AND api_key_hash IS NULL AND signing_secret_ciphertext IS NULL))) OR
    (provider NOT IN ('WEBHOOK', 'PUBLIC_API') AND api_key_hash IS NULL AND signing_secret_ciphertext IS NULL)
  ),
  CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL) OR (status <> 'REVOKED' AND revoked_at IS NULL))
);

CREATE INDEX integration_accounts_product_recent_idx
  ON enough.integration_accounts(product_id, created_at DESC);
CREATE INDEX integration_accounts_user_recent_idx
  ON enough.integration_accounts(user_id, created_at DESC);

CREATE TABLE enough.integration_tokens (
  integration_account_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  access_token_ciphertext bytea NOT NULL,
  refresh_token_ciphertext bytea,
  token_type text NOT NULL DEFAULT 'Bearer' CHECK (char_length(token_type) <= 40),
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_account_id, product_id, user_id)
    REFERENCES enough.integration_accounts(id, product_id, user_id) ON DELETE CASCADE
);

CREATE TABLE enough.integration_sync_runs (
  id uuid PRIMARY KEY,
  integration_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  events_received integer NOT NULL DEFAULT 0 CHECK (events_received >= 0),
  events_verified integer NOT NULL DEFAULT 0 CHECK (events_verified >= 0),
  cursor text CHECK (cursor IS NULL OR char_length(cursor) <= 1000),
  UNIQUE (id, integration_account_id, product_id, user_id),
  FOREIGN KEY (integration_account_id, product_id, user_id)
    REFERENCES enough.integration_accounts(id, product_id, user_id) ON DELETE CASCADE,
  CHECK ((status = 'RUNNING' AND finished_at IS NULL) OR (status <> 'RUNNING' AND finished_at IS NOT NULL))
);

CREATE INDEX integration_sync_runs_account_recent_idx
  ON enough.integration_sync_runs(integration_account_id, started_at DESC);

CREATE TABLE enough.integration_errors (
  id uuid PRIMARY KEY,
  integration_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sync_run_id uuid,
  error_code text NOT NULL CHECK (char_length(error_code) BETWEEN 1 AND 80),
  safe_message text NOT NULL CHECK (char_length(safe_message) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_account_id, product_id, user_id)
    REFERENCES enough.integration_accounts(id, product_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (sync_run_id, integration_account_id, product_id, user_id)
    REFERENCES enough.integration_sync_runs(id, integration_account_id, product_id, user_id) ON DELETE CASCADE
);

CREATE INDEX integration_errors_account_recent_idx
  ON enough.integration_errors(integration_account_id, created_at DESC);

CREATE TABLE enough.integration_events (
  id uuid PRIMARY KEY,
  integration_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  provider_event_id text NOT NULL CHECK (char_length(provider_event_id) BETWEEN 1 AND 255),
  event_type text NOT NULL CHECK (event_type IN (
    'email.outreach_sent', 'email.reply_received',
    'calendar.interview_completed', 'calendar.demo_completed', 'calendar.sales_call_completed',
    'calendar.onboarding_completed', 'calendar.feedback_call_completed', 'calendar.retention_call_completed',
    'revenue.payment_received', 'revenue.subscription_created',
    'analytics.user_signup', 'analytics.user_activated', 'analytics.trial_started',
    'analytics.conversion_completed', 'analytics.user_retained', 'analytics.user_churned'
  )),
  user_reference_hash char(64) CHECK (user_reference_hash IS NULL OR user_reference_hash ~ '^[0-9a-f]{64}$'),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor BETWEEN 0 AND 1000000000000),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  verification_status text NOT NULL DEFAULT 'AUTHENTICATED'
    CHECK (verification_status IN ('AUTHENTICATED', 'REJECTED')),
  completion_id uuid,
  task_id uuid,
  evidence_id uuid UNIQUE,
  UNIQUE (integration_account_id, provider_event_id),
  FOREIGN KEY (integration_account_id, product_id, user_id)
    REFERENCES enough.integration_accounts(id, product_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (completion_id, task_id, product_id, user_id)
    REFERENCES enough.growth_task_completions(id, task_id, product_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id, completion_id, task_id, product_id, user_id)
    REFERENCES enough.task_evidence_items(id, completion_id, task_id, product_id, user_id) ON DELETE CASCADE,
  CHECK ((completion_id IS NULL) = (task_id IS NULL)),
  CHECK ((completion_id IS NULL) = (evidence_id IS NULL)),
  CHECK ((amount_minor IS NULL) = (currency IS NULL))
);

CREATE INDEX integration_events_product_recent_idx
  ON enough.integration_events(product_id, occurred_at DESC);
CREATE INDEX integration_events_account_recent_idx
  ON enough.integration_events(integration_account_id, received_at DESC);

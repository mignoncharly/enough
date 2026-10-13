ALTER TABLE enough.integration_events
  DROP CONSTRAINT integration_events_event_type_check,
  ADD CONSTRAINT integration_events_event_type_check CHECK (event_type IN (
    'email.outreach_sent', 'email.reply_received', 'email.conversation_continued',
    'calendar.interview_completed', 'calendar.demo_completed', 'calendar.sales_call_completed',
    'calendar.onboarding_completed', 'calendar.feedback_call_completed', 'calendar.retention_call_completed',
    'revenue.payment_received', 'revenue.checkout_completed', 'revenue.subscription_created',
    'revenue.invoice_paid', 'revenue.subscription_cancelled', 'revenue.payment_refunded',
    'analytics.user_signup', 'analytics.user_activated', 'analytics.trial_started',
    'analytics.conversion_completed', 'analytics.user_retained', 'analytics.user_churned'
  ));

ALTER TABLE enough.integration_events
  ADD COLUMN provider_origin_verified boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX integration_events_unique_outreach_recipient_idx
  ON enough.integration_events(integration_account_id, user_reference_hash)
  WHERE event_type = 'email.outreach_sent' AND user_reference_hash IS NOT NULL;

ALTER TABLE enough.integration_accounts
  ADD COLUMN last_sync_at timestamptz;

CREATE TABLE enough.integration_oauth_states (
  id uuid PRIMARY KEY,
  state_hash char(64) NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  device_id uuid REFERENCES enough.auth_devices(id) ON DELETE SET NULL,
  product_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN (
    'GMAIL', 'GOOGLE_CALENDAR', 'OUTLOOK', 'MICROSOFT_CALENDAR', 'GA4'
  )),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 100),
  scopes text[] NOT NULL DEFAULT '{}',
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  pkce_verifier_ciphertext bytea,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, user_id)
    REFERENCES enough.products(id, user_id) ON DELETE CASCADE
);

CREATE INDEX integration_oauth_states_expiry_idx
  ON enough.integration_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE enough.integration_provider_configs (
  integration_account_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ciphertext bytea,
  sync_cursor_ciphertext bytea,
  provider_account_ciphertext bytea,
  provider_account_hash char(64) CHECK (
    provider_account_hash IS NULL OR provider_account_hash ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_account_id, product_id, user_id)
    REFERENCES enough.integration_accounts(id, product_id, user_id) ON DELETE CASCADE
);

ALTER TABLE enough.integration_sync_runs
  ADD COLUMN error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 80);

CREATE INDEX integration_sync_runs_running_idx
  ON enough.integration_sync_runs(started_at)
  WHERE status = 'RUNNING';

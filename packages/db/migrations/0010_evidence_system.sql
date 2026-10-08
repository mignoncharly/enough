ALTER TABLE enough.growth_task_completions
  DROP CONSTRAINT IF EXISTS growth_task_completions_verification_status_check;

ALTER TABLE enough.growth_task_completions
  ADD COLUMN reviewed_by_user_id uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  ALTER COLUMN verification_status SET DEFAULT 'AWAITING_EVIDENCE',
  ADD CONSTRAINT growth_task_completions_verification_status_check
    CHECK (verification_status IN ('SELF_REPORTED', 'AWAITING_EVIDENCE', 'AWAITING_REVIEW', 'VERIFIED', 'REJECTED')),
  ADD CONSTRAINT growth_task_completions_review_state_check
    CHECK (
      (verification_status IN ('VERIFIED', 'REJECTED') AND reviewed_at IS NOT NULL) OR
      (verification_status IN ('SELF_REPORTED', 'AWAITING_EVIDENCE', 'AWAITING_REVIEW') AND reviewed_at IS NULL)
    ),
  ADD CONSTRAINT growth_task_completions_evidence_scope_unique
    UNIQUE (id, task_id, product_id, user_id);

-- Phase 12 rewards already written to the ledger stay marked as self-reported.
-- Other existing completions can enter the evidence workflow without receiving credits early.
UPDATE enough.growth_task_completions
SET verification_status = 'AWAITING_EVIDENCE'
WHERE verification_status = 'SELF_REPORTED' AND credit_transaction_id IS NULL;

CREATE TABLE enough.task_evidence_items (
  id uuid PRIMARY KEY,
  completion_id uuid NOT NULL,
  task_id uuid NOT NULL,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'SELF_REPORT', 'NOTE', 'URL', 'UPLOAD', 'SCREENSHOT', 'INTEGRATION'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  note text CHECK (note IS NULL OR char_length(note) <= 5000),
  evidence_url text CHECK (evidence_url IS NULL OR char_length(evidence_url) <= 2048),
  integration_provider text CHECK (integration_provider IS NULL OR integration_provider IN (
    'gmail', 'google_calendar', 'outlook', 'microsoft_calendar', 'stripe',
    'posthog', 'plausible', 'ga4', 'webhook', 'public_api', 'other'
  )),
  integration_reference text CHECK (integration_reference IS NULL OR char_length(integration_reference) BETWEEN 1 AND 300),
  provenance text NOT NULL DEFAULT 'USER_SUBMITTED' CHECK (provenance IN ('USER_SUBMITTED', 'SERVER_VERIFIED')),
  original_file_name text CHECK (original_file_name IS NULL OR char_length(original_file_name) BETWEEN 1 AND 160),
  content_type text CHECK (content_type IS NULL OR content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  file_size integer CHECK (file_size IS NULL OR file_size BETWEEN 1 AND 2097152),
  file_sha256 char(64) CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  file_data bytea,
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  reviewed_by_user_id uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, completion_id, task_id, product_id, user_id),
  FOREIGN KEY (completion_id, task_id, product_id, user_id)
    REFERENCES enough.growth_task_completions(id, task_id, product_id, user_id) ON DELETE CASCADE,
  CHECK (
    (evidence_type IN ('SELF_REPORT', 'NOTE') AND note IS NOT NULL AND evidence_url IS NULL AND
      integration_provider IS NULL AND integration_reference IS NULL AND file_data IS NULL AND
      original_file_name IS NULL AND content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL) OR
    (evidence_type = 'URL' AND evidence_url IS NOT NULL AND integration_provider IS NULL AND
      integration_reference IS NULL AND file_data IS NULL AND original_file_name IS NULL AND
      content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL) OR
    (evidence_type IN ('UPLOAD', 'SCREENSHOT') AND file_data IS NOT NULL AND original_file_name IS NOT NULL AND
      content_type IS NOT NULL AND file_size IS NOT NULL AND file_sha256 IS NOT NULL AND
      octet_length(file_data) = file_size AND evidence_url IS NULL AND integration_provider IS NULL AND
      integration_reference IS NULL AND (evidence_type <> 'SCREENSHOT' OR content_type IN ('image/png', 'image/jpeg', 'image/webp'))) OR
    (evidence_type = 'INTEGRATION' AND integration_provider IS NOT NULL AND integration_reference IS NOT NULL AND
      evidence_url IS NULL AND file_data IS NULL AND original_file_name IS NULL AND content_type IS NULL AND
      file_size IS NULL AND file_sha256 IS NULL)
  ),
  CHECK (
    (verification_status = 'PENDING' AND reviewed_at IS NULL) OR
    (verification_status IN ('VERIFIED', 'REJECTED') AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX task_evidence_completion_recent_idx
  ON enough.task_evidence_items(completion_id, created_at DESC);
CREATE INDEX task_evidence_product_recent_idx
  ON enough.task_evidence_items(product_id, created_at DESC);
CREATE INDEX task_evidence_user_recent_idx
  ON enough.task_evidence_items(user_id, created_at DESC);

CREATE TABLE enough.privacy_preferences (
  user_id uuid PRIMARY KEY REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  activity_retention_days integer NOT NULL DEFAULT 365
    CHECK (activity_retention_days IN (30, 90, 180, 365, 730, 1825, 3650)),
  notification_retention_days integer NOT NULL DEFAULT 365
    CHECK (notification_retention_days IN (30, 90, 180, 365, 730, 1825, 3650)),
  audit_retention_days integer NOT NULL DEFAULT 730
    CHECK (audit_retention_days IN (30, 90, 180, 365, 730, 1825, 3650)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.privacy_consents (
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('ACTIVITY_COLLECTION', 'AI_PROVIDER_PROCESSING')),
  enabled boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL DEFAULT '2026-10-06' CHECK (char_length(policy_version) BETWEEN 1 AND 40),
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'desktop', 'extension')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  granted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purpose),
  CHECK (NOT enabled OR (granted_at IS NOT NULL AND revoked_at IS NULL))
);

ALTER TABLE enough.task_evidence_items
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX task_evidence_deleted_user_idx
  ON enough.task_evidence_items(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX activity_events_user_effective_idx
  ON enough.activity_events(user_id, effective_at);

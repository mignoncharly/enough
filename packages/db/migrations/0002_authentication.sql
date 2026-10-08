CREATE TABLE enough.auth_users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  display_name text,
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX auth_identities_user_id_idx ON enough.auth_identities(user_id);

CREATE TABLE enough.auth_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  client_type text NOT NULL CHECK (client_type IN ('web', 'desktop', 'extension')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX auth_devices_user_active_idx
  ON enough.auth_devices(user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE enough.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES enough.auth_devices(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_token_hash bytea,
  credential_type text NOT NULL CHECK (credential_type IN ('cookie', 'bearer')),
  auth_method text NOT NULL CHECK (auth_method IN ('password', 'magic_link', 'google', 'github')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((credential_type = 'cookie' AND csrf_token_hash IS NOT NULL) OR
         (credential_type = 'bearer' AND csrf_token_hash IS NULL))
);

CREATE INDEX auth_sessions_user_active_idx
  ON enough.auth_sessions(user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_device_active_idx
  ON enough.auth_sessions(device_id)
  WHERE revoked_at IS NULL;

CREATE TABLE enough.auth_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset', 'magic_link', 'oauth_exchange')),
  binding_hash bytea,
  source_provider text CHECK (source_provider IN ('google', 'github')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'oauth_exchange' AND binding_hash IS NOT NULL AND source_provider IS NOT NULL) OR
         (purpose <> 'oauth_exchange' AND binding_hash IS NULL AND source_provider IS NULL))
);

CREATE INDEX auth_tokens_user_purpose_active_idx
  ON enough.auth_tokens(user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE enough.auth_oauth_states (
  state_hash bytea PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  encrypted_code_verifier bytea NOT NULL,
  csrf_binding_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX auth_oauth_states_expiry_idx ON enough.auth_oauth_states(expires_at);

CREATE TABLE enough.auth_audit_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES enough.auth_devices(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX auth_audit_events_user_created_idx
  ON enough.auth_audit_events(user_id, created_at DESC);

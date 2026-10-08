CREATE TABLE enough.admin_roles (
  user_id uuid PRIMARY KEY REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('ADMIN', 'SUPPORT')),
  granted_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.admin_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 3 AND 100),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 2 AND 60),
  target_id text CHECK (target_id IS NULL OR char_length(target_id) <= 200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_events_recent_idx
  ON enough.admin_audit_events(created_at DESC, id DESC);
CREATE INDEX admin_audit_events_actor_recent_idx
  ON enough.admin_audit_events(actor_user_id, created_at DESC);

CREATE TABLE enough.admin_feature_flags (
  flag_key text PRIMARY KEY CHECK (flag_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 2 AND 500),
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent smallint NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  created_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.admin_rule_templates (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 2 AND 500),
  action text NOT NULL CHECK (action IN ('ALLOW', 'BLOCK', 'WARN', 'REQUIRE_OVERRIDE')),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10000 AND 10000),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  schedule jsonb CHECK (schedule IS NULL OR jsonb_typeof(schedule) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enough.admin_ai_usage_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  capability text NOT NULL CHECK (char_length(capability) BETWEEN 2 AND 80),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_ai_usage_recent_idx
  ON enough.admin_ai_usage_events(created_at DESC);
CREATE INDEX admin_ai_usage_user_recent_idx
  ON enough.admin_ai_usage_events(user_id, created_at DESC);

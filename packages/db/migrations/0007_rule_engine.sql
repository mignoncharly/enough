CREATE UNIQUE INDEX auth_devices_id_user_unique_idx
  ON enough.auth_devices(id, user_id);

CREATE TABLE enough.policy_rules (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid,
  device_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10000 AND 10000),
  action text NOT NULL CHECK (action IN ('ALLOW', 'BLOCK', 'WARN', 'REQUIRE_OVERRIDE')),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (id, user_id),
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, user_id) REFERENCES enough.auth_devices(id, user_id) ON DELETE CASCADE
);

CREATE INDEX policy_rules_user_active_idx
  ON enough.policy_rules(user_id, enabled, priority DESC)
  WHERE archived_at IS NULL;
CREATE INDEX policy_rules_scope_idx
  ON enough.policy_rules(user_id, product_id, device_id)
  WHERE archived_at IS NULL;

CREATE TABLE enough.policy_rule_versions (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (rule_id, user_id) REFERENCES enough.policy_rules(id, user_id) ON DELETE CASCADE,
  UNIQUE (rule_id, version)
);

CREATE INDEX policy_rule_versions_history_idx
  ON enough.policy_rule_versions(user_id, rule_id, version DESC);

CREATE TABLE enough.policy_overrides (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid,
  device_id uuid,
  tool_kind text NOT NULL CHECK (tool_kind IN ('APPLICATION', 'DOMAIN')),
  tool_key text NOT NULL CHECK (char_length(tool_key) BETWEEN 1 AND 255),
  action text NOT NULL CHECK (action IN ('ALLOW', 'BLOCK')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 300),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, user_id) REFERENCES enough.auth_devices(id, user_id) ON DELETE CASCADE,
  CHECK (expires_at > starts_at)
);

CREATE INDEX policy_overrides_user_active_idx
  ON enough.policy_overrides(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX policy_overrides_tool_lookup_idx
  ON enough.policy_overrides(user_id, tool_kind, tool_key, expires_at DESC)
  WHERE revoked_at IS NULL;

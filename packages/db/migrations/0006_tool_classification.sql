CREATE TABLE enough.tool_classification_catalog (
  id uuid PRIMARY KEY,
  tool_kind text NOT NULL CHECK (tool_kind IN ('APPLICATION', 'DOMAIN')),
  tool_key text NOT NULL CHECK (char_length(tool_key) BETWEEN 1 AND 255),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  classification text NOT NULL CHECK (classification IN (
    'BUILD', 'GROWTH', 'NEUTRAL', 'CONTEXTUAL', 'BLOCKED', 'ALLOWED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_kind, tool_key)
);

CREATE TABLE enough.tool_classification_mappings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid,
  tool_kind text NOT NULL CHECK (tool_kind IN ('APPLICATION', 'DOMAIN')),
  tool_key text NOT NULL CHECK (char_length(tool_key) BETWEEN 1 AND 255),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  classification text NOT NULL CHECK (classification IN (
    'BUILD', 'GROWTH', 'NEUTRAL', 'CONTEXTUAL', 'BLOCKED', 'ALLOWED'
  )),
  context_key text NOT NULL DEFAULT '' CHECK (char_length(context_key) <= 80),
  context_value text NOT NULL DEFAULT '' CHECK (char_length(context_value) <= 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  CHECK ((context_key = '') = (context_value = ''))
);

CREATE UNIQUE INDEX tool_classification_mappings_account_unique_idx
  ON enough.tool_classification_mappings(user_id, tool_kind, tool_key, context_key, context_value)
  WHERE product_id IS NULL;
CREATE UNIQUE INDEX tool_classification_mappings_product_unique_idx
  ON enough.tool_classification_mappings(user_id, product_id, tool_kind, tool_key, context_key, context_value)
  WHERE product_id IS NOT NULL;
CREATE INDEX tool_classification_mappings_user_lookup_idx
  ON enough.tool_classification_mappings(user_id, tool_kind, tool_key, product_id);

INSERT INTO enough.tool_classification_catalog
  (id, tool_kind, tool_key, display_name, classification)
VALUES
  (gen_random_uuid(), 'APPLICATION', 'com.apple.safari', 'Safari', 'NEUTRAL'),
  (gen_random_uuid(), 'APPLICATION', 'com.figma.desktop', 'Figma', 'BUILD'),
  (gen_random_uuid(), 'APPLICATION', 'com.google.chrome', 'Google Chrome', 'NEUTRAL'),
  (gen_random_uuid(), 'APPLICATION', 'com.linear', 'Linear', 'BUILD'),
  (gen_random_uuid(), 'APPLICATION', 'com.microsoft.vscode', 'Visual Studio Code', 'BUILD'),
  (gen_random_uuid(), 'APPLICATION', 'com.notion.desktop', 'Notion', 'NEUTRAL'),
  (gen_random_uuid(), 'APPLICATION', 'com.postmanlabs.mac', 'Postman', 'BUILD'),
  (gen_random_uuid(), 'APPLICATION', 'com.tinyspeck.slackmacgap', 'Slack', 'GROWTH'),
  (gen_random_uuid(), 'APPLICATION', 'com.todesktop.230313mzl4w4u92', 'Cursor', 'BUILD'),
  (gen_random_uuid(), 'APPLICATION', 'com.openai.chat', 'ChatGPT', 'CONTEXTUAL'),
  (gen_random_uuid(), 'APPLICATION', 'com.anthropic.claudefordesktop', 'Claude', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'chatgpt.com', 'ChatGPT', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'claude.ai', 'Claude', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'docs.google.com', 'Google Docs', 'NEUTRAL'),
  (gen_random_uuid(), 'DOMAIN', 'figma.com', 'Figma', 'BUILD'),
  (gen_random_uuid(), 'DOMAIN', 'github.com', 'GitHub', 'BUILD'),
  (gen_random_uuid(), 'DOMAIN', 'gitlab.com', 'GitLab', 'BUILD'),
  (gen_random_uuid(), 'DOMAIN', 'linkedin.com', 'LinkedIn', 'GROWTH'),
  (gen_random_uuid(), 'DOMAIN', 'mailchimp.com', 'Mailchimp', 'GROWTH'),
  (gen_random_uuid(), 'DOMAIN', 'notion.so', 'Notion', 'NEUTRAL'),
  (gen_random_uuid(), 'DOMAIN', 'npmjs.com', 'npm', 'BUILD'),
  (gen_random_uuid(), 'DOMAIN', 'producthunt.com', 'Product Hunt', 'GROWTH'),
  (gen_random_uuid(), 'DOMAIN', 'reddit.com', 'Reddit', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'slack.com', 'Slack', 'GROWTH'),
  (gen_random_uuid(), 'DOMAIN', 'stackoverflow.com', 'Stack Overflow', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'stripe.com', 'Stripe', 'NEUTRAL'),
  (gen_random_uuid(), 'DOMAIN', 'vercel.com', 'Vercel', 'BUILD'),
  (gen_random_uuid(), 'DOMAIN', 'youtube.com', 'YouTube', 'CONTEXTUAL'),
  (gen_random_uuid(), 'DOMAIN', 'x.com', 'X', 'GROWTH')
ON CONFLICT (tool_kind, tool_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    classification = EXCLUDED.classification,
    updated_at = now();

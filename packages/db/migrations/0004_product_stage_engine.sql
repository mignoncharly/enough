CREATE TABLE enough.products (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 240),
  target_customer text NOT NULL CHECK (char_length(target_customer) BETWEEN 2 AND 240),
  problem_statement text NOT NULL CHECK (char_length(problem_statement) BETWEEN 3 AND 500),
  product_stage text NOT NULL CHECK (product_stage IN (
    'IDEA',
    'PROBLEM_VALIDATION',
    'SOLUTION_VALIDATION',
    'PRE_LAUNCH',
    'LAUNCHED_ZERO_USERS',
    'EARLY_USERS',
    'FIRST_REVENUE',
    'PRODUCT_MARKET_SIGNAL',
    'GROWTH'
  )),
  has_launched boolean NOT NULL DEFAULT false,
  user_count integer NOT NULL DEFAULT 0 CHECK (user_count >= 0),
  paying_user_count integer NOT NULL DEFAULT 0 CHECK (paying_user_count >= 0 AND paying_user_count <= user_count),
  current_revenue numeric(14, 2) CHECK (current_revenue IS NULL OR current_revenue >= 0),
  revenue_currency char(3) NOT NULL DEFAULT 'EUR' CHECK (revenue_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX products_user_name_idx ON enough.products(user_id, lower(name));
CREATE INDEX products_user_updated_idx ON enough.products(user_id, updated_at DESC);

CREATE TABLE enough.product_stage_history (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES enough.products(id) ON DELETE CASCADE,
  from_stage text CHECK (from_stage IS NULL OR from_stage IN (
    'IDEA', 'PROBLEM_VALIDATION', 'SOLUTION_VALIDATION', 'PRE_LAUNCH',
    'LAUNCHED_ZERO_USERS', 'EARLY_USERS', 'FIRST_REVENUE',
    'PRODUCT_MARKET_SIGNAL', 'GROWTH'
  )),
  to_stage text NOT NULL CHECK (to_stage IN (
    'IDEA', 'PROBLEM_VALIDATION', 'SOLUTION_VALIDATION', 'PRE_LAUNCH',
    'LAUNCHED_ZERO_USERS', 'EARLY_USERS', 'FIRST_REVENUE',
    'PRODUCT_MARKET_SIGNAL', 'GROWTH'
  )),
  change_reason text CHECK (change_reason IS NULL OR char_length(change_reason) <= 500),
  changed_by uuid REFERENCES enough.auth_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_stage IS DISTINCT FROM to_stage)
);

CREATE INDEX product_stage_history_product_changed_idx
  ON enough.product_stage_history(product_id, changed_at DESC);

CREATE TABLE enough.product_goals (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  goal_type text NOT NULL CHECK (goal_type IN (
    'PROBLEM_RESEARCH', 'CUSTOMER_INTERVIEWS', 'PROTOTYPE_TESTS', 'WAITLIST',
    'LAUNCH', 'SIGNUPS', 'ACTIVATION', 'RETENTION', 'REVENUE', 'CUSTOM'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 250),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  target_value numeric(14, 4) CHECK (target_value IS NULL OR target_value >= 0),
  unit text CHECK (unit IS NULL OR char_length(unit) <= 32),
  is_primary boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX product_goals_one_active_primary_idx
  ON enough.product_goals(product_id) WHERE is_primary AND status = 'ACTIVE';
CREATE INDEX product_goals_product_status_idx ON enough.product_goals(product_id, status, created_at DESC);

CREATE TABLE enough.product_metrics (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES enough.products(id) ON DELETE CASCADE,
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 100),
  value numeric(18, 4) NOT NULL,
  unit text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 32),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_metrics_product_recent_idx
  ON enough.product_metrics(product_id, recorded_at DESC);
CREATE INDEX product_metrics_key_recent_idx
  ON enough.product_metrics(product_id, metric_key, recorded_at DESC);

ALTER TABLE enough.onboarding_profiles
  ADD COLUMN product_id uuid UNIQUE REFERENCES enough.products(id) ON DELETE SET NULL;

UPDATE enough.onboarding_profiles
SET has_launched = true
WHERE product_stage IN (
  'LAUNCHED_ZERO_USERS', 'EARLY_USERS', 'FIRST_REVENUE', 'PRODUCT_MARKET_SIGNAL', 'GROWTH'
);

WITH created_products AS (
  INSERT INTO enough.products
    (id, user_id, name, target_customer, problem_statement, product_stage, has_launched,
     user_count, paying_user_count, current_revenue, revenue_currency, created_at, updated_at)
  SELECT gen_random_uuid(), user_id, product_description, target_customer, problem_statement,
         product_stage, has_launched, user_count, paying_user_count, current_revenue,
         revenue_currency, created_at, updated_at
  FROM enough.onboarding_profiles
  RETURNING id, user_id
)
UPDATE enough.onboarding_profiles AS profile
SET product_id = created_products.id
FROM created_products
WHERE profile.user_id = created_products.user_id;

INSERT INTO enough.product_stage_history
  (id, product_id, from_stage, to_stage, change_reason, changed_by, changed_at)
SELECT gen_random_uuid(), product.id, NULL, product.product_stage, 'Initial stage from onboarding', product.user_id, product.created_at
FROM enough.products AS product
JOIN enough.onboarding_profiles AS profile ON profile.product_id = product.id;

INSERT INTO enough.product_goals
  (id, product_id, user_id, goal_type, title, status, is_primary, created_at, updated_at)
SELECT gen_random_uuid(), product.id, product.user_id, 'CUSTOM', profile.next_goal, 'ACTIVE', true,
       profile.created_at, profile.updated_at
FROM enough.products AS product
JOIN enough.onboarding_profiles AS profile ON profile.product_id = product.id;

INSERT INTO enough.product_metrics (id, product_id, metric_key, display_name, value, unit, recorded_at)
SELECT gen_random_uuid(), product.id, 'total_users', 'Total users', product.user_count, 'users', product.created_at
FROM enough.products AS product
UNION ALL
SELECT gen_random_uuid(), product.id, 'paying_users', 'Paying users', product.paying_user_count, 'users', product.created_at
FROM enough.products AS product
UNION ALL
SELECT gen_random_uuid(), product.id, 'current_revenue', 'Current revenue', product.current_revenue, product.revenue_currency, product.created_at
FROM enough.products AS product
WHERE product.current_revenue IS NOT NULL;

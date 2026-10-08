CREATE TABLE enough.onboarding_profiles (
  user_id uuid PRIMARY KEY REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_description text NOT NULL CHECK (char_length(product_description) BETWEEN 3 AND 240),
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
  has_launched boolean NOT NULL,
  user_count integer NOT NULL CHECK (user_count >= 0),
  paying_user_count integer NOT NULL CHECK (paying_user_count >= 0 AND paying_user_count <= user_count),
  current_revenue numeric(14, 2) CHECK (current_revenue IS NULL OR current_revenue >= 0),
  revenue_currency char(3) NOT NULL DEFAULT 'EUR' CHECK (revenue_currency ~ '^[A-Z]{3}$'),
  next_goal text NOT NULL CHECK (char_length(next_goal) BETWEEN 2 AND 250),
  build_tools text[] NOT NULL DEFAULT '{}',
  recommended_config jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(build_tools) <= 20)
);

CREATE INDEX onboarding_profiles_stage_idx ON enough.onboarding_profiles(product_stage);

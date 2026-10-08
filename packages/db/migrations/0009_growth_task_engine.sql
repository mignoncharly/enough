CREATE TABLE enough.growth_task_templates (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{3,80}$'),
  product_stage text NOT NULL CHECK (product_stage IN (
    'IDEA', 'PROBLEM_VALIDATION', 'SOLUTION_VALIDATION', 'PRE_LAUNCH',
    'LAUNCHED_ZERO_USERS', 'EARLY_USERS', 'FIRST_REVENUE',
    'PRODUCT_MARKET_SIGNAL', 'GROWTH'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 250),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  signal_strength smallint NOT NULL DEFAULT 3 CHECK (signal_strength BETWEEN 1 AND 5),
  estimated_minutes smallint NOT NULL DEFAULT 30 CHECK (estimated_minutes BETWEEN 5 AND 600),
  default_reward_credits integer NOT NULL DEFAULT 0 CHECK (default_reward_credits BETWEEN 0 AND 10000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX growth_task_templates_stage_idx
  ON enough.growth_task_templates(product_stage, is_active, priority DESC, id);

INSERT INTO enough.growth_task_templates
  (id, product_stage, title, priority, signal_strength, estimated_minutes, default_reward_credits)
VALUES
  ('idea-1', 'IDEA', 'List the people most likely to experience the problem', 5, 4, 25, 10),
  ('idea-2', 'IDEA', 'Ask a prospective customer how they handle it today', 4, 5, 30, 10),
  ('idea-3', 'IDEA', 'Write down the strongest recurring pain you hear', 3, 4, 20, 5),
  ('problem-validation-1', 'PROBLEM_VALIDATION', 'Schedule a conversation with someone in your target group', 5, 5, 20, 10),
  ('problem-validation-2', 'PROBLEM_VALIDATION', 'Ask what the problem costs them in time or money', 4, 5, 30, 10),
  ('problem-validation-3', 'PROBLEM_VALIDATION', 'Compare the workarounds across your conversations', 3, 4, 30, 5),
  ('solution-validation-1', 'SOLUTION_VALIDATION', 'Invite a target customer to try the smallest useful prototype', 5, 5, 45, 10),
  ('solution-validation-2', 'SOLUTION_VALIDATION', 'Watch a user complete one important task', 4, 5, 45, 10),
  ('solution-validation-3', 'SOLUTION_VALIDATION', 'Ask a tester what they would do next without prompting', 3, 4, 20, 5),
  ('pre-launch-1', 'PRE_LAUNCH', 'Invite a qualified prospect to join the beta', 5, 5, 30, 10),
  ('pre-launch-2', 'PRE_LAUNCH', 'Test the signup and first-use path', 4, 4, 45, 10),
  ('pre-launch-3', 'PRE_LAUNCH', 'Choose one launch channel and prepare its first message', 3, 4, 40, 5),
  ('launched-zero-users-1', 'LAUNCHED_ZERO_USERS', 'Contact a likely customer with a specific reason to try the product', 5, 5, 30, 10),
  ('launched-zero-users-2', 'LAUNCHED_ZERO_USERS', 'Walk through signup as a new user', 4, 4, 30, 10),
  ('launched-zero-users-3', 'LAUNCHED_ZERO_USERS', 'Follow up with a person who visited or registered', 3, 4, 20, 5),
  ('early-users-1', 'EARLY_USERS', 'Ask an active user what brings them back', 5, 5, 25, 10),
  ('early-users-2', 'EARLY_USERS', 'Reach out to a user who stopped returning', 4, 5, 25, 10),
  ('early-users-3', 'EARLY_USERS', 'Remove one observed obstacle from the first-use flow', 3, 4, 45, 5),
  ('first-revenue-1', 'FIRST_REVENUE', 'Ask a paying customer what made the purchase worthwhile', 5, 5, 25, 10),
  ('first-revenue-2', 'FIRST_REVENUE', 'Review one lost sale and identify the unresolved concern', 4, 4, 30, 10),
  ('first-revenue-3', 'FIRST_REVENUE', 'Document the steps from first conversation to payment', 3, 4, 30, 5),
  ('product-market-signal-1', 'PRODUCT_MARKET_SIGNAL', 'Review which customer group returns most consistently', 5, 5, 30, 10),
  ('product-market-signal-2', 'PRODUCT_MARKET_SIGNAL', 'Trace a recent signup to its discovery channel', 4, 4, 30, 10),
  ('product-market-signal-3', 'PRODUCT_MARKET_SIGNAL', 'Ask a retained customer what would make the product essential', 3, 5, 25, 5),
  ('growth-1', 'GROWTH', 'Compare conversion quality across active acquisition channels', 5, 5, 40, 10),
  ('growth-2', 'GROWTH', 'Improve one bottleneck in the strongest channel', 4, 4, 45, 10),
  ('growth-3', 'GROWTH', 'Review a recent customer outcome with the product team', 3, 4, 30, 5);

CREATE TABLE enough.growth_tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  template_id text REFERENCES enough.growth_task_templates(id) ON DELETE SET NULL,
  series_id uuid NOT NULL,
  sequence_number integer NOT NULL DEFAULT 1 CHECK (sequence_number > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 250),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  signal_strength smallint NOT NULL DEFAULT 3 CHECK (signal_strength BETWEEN 1 AND 5),
  estimated_minutes smallint NOT NULL DEFAULT 30 CHECK (estimated_minutes BETWEEN 5 AND 600),
  reward_credits integer NOT NULL DEFAULT 0 CHECK (reward_credits BETWEEN 0 AND 10000),
  recurrence_days smallint CHECK (recurrence_days IS NULL OR recurrence_days BETWEEN 1 AND 365),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, product_id, user_id),
  UNIQUE (series_id, sequence_number),
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL) OR
         (status <> 'COMPLETED' AND completed_at IS NULL))
);

CREATE UNIQUE INDEX growth_tasks_one_active_per_series_idx
  ON enough.growth_tasks(series_id) WHERE status = 'ACTIVE';
CREATE INDEX growth_tasks_product_status_priority_idx
  ON enough.growth_tasks(product_id, status, priority DESC, due_at ASC NULLS LAST, created_at DESC);
CREATE INDEX growth_tasks_user_created_idx
  ON enough.growth_tasks(user_id, created_at DESC);

CREATE TABLE enough.growth_task_completions (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  verification_status text NOT NULL DEFAULT 'SELF_REPORTED' CHECK (verification_status IN ('SELF_REPORTED')),
  reward_credits integer NOT NULL DEFAULT 0 CHECK (reward_credits BETWEEN 0 AND 10000),
  credit_transaction_id uuid REFERENCES enough.credit_transactions(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id),
  FOREIGN KEY (task_id, product_id, user_id)
    REFERENCES enough.growth_tasks(id, product_id, user_id) ON DELETE CASCADE
);

CREATE INDEX growth_task_completions_user_recent_idx
  ON enough.growth_task_completions(user_id, completed_at DESC);

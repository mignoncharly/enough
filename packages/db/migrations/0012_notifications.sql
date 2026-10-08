CREATE TABLE enough.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  web_enabled boolean NOT NULL DEFAULT true,
  desktop_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 100),
  quiet_start time,
  quiet_end time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start IS NULL AND quiet_end IS NULL) OR
         (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start <> quiet_end))
);

CREATE TABLE enough.notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid,
  notification_type text NOT NULL CHECK (notification_type IN (
    'CREDIT_EARNED', 'STAGE_CHANGED', 'MARKET_SIGNAL', 'TASK_REVIEW'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 500),
  href text NOT NULL CHECK (left(href, 1) = '/' AND left(href, 2) <> '//' AND href !~ '[[:cntrl:]]'),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 8 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  desktop_status text NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (desktop_status IN ('PENDING', 'DELIVERED', 'NOT_REQUESTED')),
  desktop_delivered_at timestamptz,
  email_status text NOT NULL DEFAULT 'SKIPPED'
    CHECK (email_status IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED')),
  email_available_at timestamptz,
  email_attempts smallint NOT NULL DEFAULT 0 CHECK (email_attempts BETWEEN 0 AND 5),
  email_sent_at timestamptz,
  UNIQUE (user_id, dedupe_key),
  FOREIGN KEY (product_id, user_id)
    REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  CHECK ((desktop_status = 'DELIVERED' AND desktop_delivered_at IS NOT NULL) OR
         (desktop_status <> 'DELIVERED' AND desktop_delivered_at IS NULL)),
  CHECK ((email_status = 'PENDING' AND email_available_at IS NOT NULL) OR
         (email_status <> 'PENDING' AND email_available_at IS NULL)),
  CHECK ((email_status = 'SENT' AND email_sent_at IS NOT NULL) OR
         (email_status <> 'SENT' AND email_sent_at IS NULL))
);

CREATE INDEX notifications_user_recent_idx
  ON enough.notifications(user_id, created_at DESC, id DESC);
CREATE INDEX notifications_desktop_pending_idx
  ON enough.notifications(user_id, created_at ASC)
  WHERE desktop_status = 'PENDING';
CREATE INDEX notifications_email_pending_idx
  ON enough.notifications(email_available_at ASC, created_at ASC)
  WHERE email_status = 'PENDING';

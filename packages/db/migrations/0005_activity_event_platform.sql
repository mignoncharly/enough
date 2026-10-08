CREATE TABLE enough.activity_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES enough.auth_users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  device_id uuid REFERENCES enough.auth_devices(id) ON DELETE SET NULL,
  client_event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  event_version smallint NOT NULL DEFAULT 1 CHECK (event_version BETWEEN 1 AND 32767),
  client_sequence bigint NOT NULL CHECK (client_sequence >= 0),
  client_occurred_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  clock_adjusted boolean NOT NULL DEFAULT false,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  batch_id uuid NOT NULL,
  FOREIGN KEY (product_id, user_id) REFERENCES enough.products(id, user_id) ON DELETE CASCADE,
  UNIQUE (user_id, client_event_id)
);

CREATE INDEX activity_events_product_order_idx
  ON enough.activity_events(product_id, effective_at, device_id, client_sequence);
CREATE INDEX activity_events_product_type_time_idx
  ON enough.activity_events(product_id, event_type, effective_at DESC);
CREATE UNIQUE INDEX activity_events_device_product_sequence_idx
  ON enough.activity_events(device_id, product_id, client_sequence)
  WHERE device_id IS NOT NULL;
CREATE INDEX activity_events_batch_idx
  ON enough.activity_events(batch_id);

CREATE TABLE enough.activity_event_aggregates (
  product_id uuid NOT NULL REFERENCES enough.products(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  bucket_start timestamptz NOT NULL,
  event_count bigint NOT NULL CHECK (event_count > 0),
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, event_type, bucket_start)
);

CREATE INDEX activity_event_aggregates_recent_idx
  ON enough.activity_event_aggregates(product_id, bucket_start DESC);

ALTER TABLE enough.task_evidence_items
  DROP CONSTRAINT task_evidence_items_check;

ALTER TABLE enough.task_evidence_items
  ADD COLUMN storage_object_key text UNIQUE,
  ADD COLUMN storage_staging_key text UNIQUE,
  ADD COLUMN storage_state text NOT NULL DEFAULT 'NONE'
    CHECK (storage_state IN ('NONE', 'MIGRATION_PENDING', 'FINALIZING', 'READY')),
  ADD COLUMN upload_idempotency_key uuid,
  ADD COLUMN upload_request_sha256 char(64)
    CHECK (upload_request_sha256 IS NULL OR upload_request_sha256 ~ '^[0-9a-f]{64}$');

UPDATE enough.task_evidence_items
SET storage_state = 'MIGRATION_PENDING'
WHERE evidence_type IN ('UPLOAD', 'SCREENSHOT')
  AND file_data IS NOT NULL
  AND deleted_at IS NULL;

ALTER TABLE enough.task_evidence_items
  ADD CONSTRAINT task_evidence_items_storage_shape_check CHECK (
    (evidence_type IN ('SELF_REPORT', 'NOTE') AND note IS NOT NULL AND evidence_url IS NULL AND
      integration_provider IS NULL AND integration_reference IS NULL AND file_data IS NULL AND
      original_file_name IS NULL AND content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL AND
      storage_state = 'NONE' AND storage_object_key IS NULL AND storage_staging_key IS NULL AND
      upload_idempotency_key IS NULL AND upload_request_sha256 IS NULL) OR
    (evidence_type = 'URL' AND evidence_url IS NOT NULL AND integration_provider IS NULL AND
      integration_reference IS NULL AND file_data IS NULL AND original_file_name IS NULL AND
      content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL AND storage_state = 'NONE' AND
      storage_object_key IS NULL AND storage_staging_key IS NULL AND upload_idempotency_key IS NULL AND
      upload_request_sha256 IS NULL) OR
    (evidence_type IN ('UPLOAD', 'SCREENSHOT') AND original_file_name IS NOT NULL AND
      content_type IS NOT NULL AND file_size IS NOT NULL AND file_sha256 IS NOT NULL AND
      evidence_url IS NULL AND integration_provider IS NULL AND integration_reference IS NULL AND
      (evidence_type <> 'SCREENSHOT' OR content_type IN ('image/png', 'image/jpeg', 'image/webp')) AND
      ((storage_state = 'MIGRATION_PENDING' AND file_data IS NOT NULL AND
        octet_length(file_data) = file_size AND storage_object_key IS NULL AND storage_staging_key IS NULL) OR
       (storage_state = 'FINALIZING' AND file_data IS NULL AND storage_object_key LIKE 'obj-%' AND
        storage_staging_key LIKE 'stage-%' AND upload_idempotency_key IS NOT NULL AND
        upload_request_sha256 IS NOT NULL) OR
       (storage_state = 'READY' AND file_data IS NULL AND storage_object_key LIKE 'obj-%' AND
        storage_staging_key IS NULL AND upload_idempotency_key IS NOT NULL AND
        upload_request_sha256 IS NOT NULL))) OR
    (evidence_type = 'INTEGRATION' AND integration_provider IS NOT NULL AND
      integration_reference IS NOT NULL AND evidence_url IS NULL AND file_data IS NULL AND
      original_file_name IS NULL AND content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL AND
      storage_state = 'NONE' AND storage_object_key IS NULL AND storage_staging_key IS NULL AND
      upload_idempotency_key IS NULL AND upload_request_sha256 IS NULL)
  );

CREATE UNIQUE INDEX task_evidence_upload_idempotency_idx
  ON enough.task_evidence_items(user_id, upload_idempotency_key)
  WHERE upload_idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE enough.task_evidence_object_cleanup (
  object_key text PRIMARY KEY CHECK (object_key ~ '^(obj|stage)-[A-Za-z0-9_-]{32,}$'),
  evidence_id uuid,
  user_id uuid,
  reason text NOT NULL CHECK (reason IN ('EVIDENCE_DELETE', 'ACCOUNT_DELETE', 'STAGING_FINALIZED', 'ORPHAN')),
  CHECK ((reason = 'ORPHAN' AND evidence_id IS NULL AND user_id IS NULL) OR
         (reason <> 'ORPHAN' AND evidence_id IS NOT NULL AND user_id IS NOT NULL)),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_evidence_object_cleanup_due_idx
  ON enough.task_evidence_object_cleanup(next_attempt_at, created_at);

CREATE TABLE enough.task_evidence_storage_reconcile_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  cleanup_objects integer NOT NULL DEFAULT 0 CHECK (cleanup_objects BETWEEN 0 AND 100),
  finalized_uploads integer NOT NULL DEFAULT 0 CHECK (finalized_uploads BETWEEN 0 AND 25),
  scanned_objects integer NOT NULL DEFAULT 0 CHECK (scanned_objects BETWEEN 0 AND 100),
  removed_orphans integer NOT NULL DEFAULT 0 CHECK (removed_orphans BETWEEN 0 AND 100),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 225),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 80)
);

CREATE TABLE enough.task_evidence_storage_reconcile_state (
  id text PRIMARY KEY CHECK (id IN ('objects', 'staging')),
  continuation_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO enough.task_evidence_storage_reconcile_state (id)
VALUES ('objects'), ('staging');

CREATE FUNCTION enough.enqueue_evidence_object_cleanup(
  cleanup_key text,
  cleanup_evidence_id uuid,
  cleanup_user_id uuid,
  cleanup_reason text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF cleanup_key IS NOT NULL THEN
    INSERT INTO enough.task_evidence_object_cleanup (object_key, evidence_id, user_id, reason)
    VALUES (cleanup_key, cleanup_evidence_id, cleanup_user_id, cleanup_reason)
    ON CONFLICT (object_key) DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION enough.capture_evidence_object_keys_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key THEN
    PERFORM enough.enqueue_evidence_object_cleanup(
      OLD.storage_object_key, OLD.id, OLD.user_id, 'EVIDENCE_DELETE'
    );
  END IF;
  IF OLD.storage_staging_key IS DISTINCT FROM NEW.storage_staging_key THEN
    PERFORM enough.enqueue_evidence_object_cleanup(
      OLD.storage_staging_key, OLD.id, OLD.user_id, 'STAGING_FINALIZED'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enough.capture_evidence_object_keys_before_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM enough.enqueue_evidence_object_cleanup(
    OLD.storage_object_key, OLD.id, OLD.user_id, 'ACCOUNT_DELETE'
  );
  PERFORM enough.enqueue_evidence_object_cleanup(
    OLD.storage_staging_key, OLD.id, OLD.user_id, 'ACCOUNT_DELETE'
  );
  RETURN OLD;
END;
$$;

CREATE TRIGGER task_evidence_object_keys_before_update
  BEFORE UPDATE OF storage_object_key, storage_staging_key ON enough.task_evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION enough.capture_evidence_object_keys_before_update();

CREATE TRIGGER task_evidence_object_keys_before_delete
  BEFORE DELETE ON enough.task_evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION enough.capture_evidence_object_keys_before_delete();

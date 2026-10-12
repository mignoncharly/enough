DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enough.task_evidence_items WHERE file_data IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Evidence BYTEA objects remain; run the checksum-verified evidence object migration before retrying database migrations.';
  END IF;
END;
$$;

ALTER TABLE enough.task_evidence_items
  DROP CONSTRAINT task_evidence_items_storage_shape_check;

ALTER TABLE enough.task_evidence_items
  DROP COLUMN file_data;

ALTER TABLE enough.task_evidence_items
  ADD CONSTRAINT task_evidence_items_storage_shape_check CHECK (
    (evidence_type IN ('SELF_REPORT', 'NOTE') AND note IS NOT NULL AND evidence_url IS NULL AND
      integration_provider IS NULL AND integration_reference IS NULL AND
      original_file_name IS NULL AND content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL AND
      storage_state = 'NONE' AND storage_object_key IS NULL AND storage_staging_key IS NULL AND
      upload_idempotency_key IS NULL AND upload_request_sha256 IS NULL) OR
    (evidence_type = 'URL' AND evidence_url IS NOT NULL AND integration_provider IS NULL AND
      integration_reference IS NULL AND original_file_name IS NULL AND content_type IS NULL AND
      file_size IS NULL AND file_sha256 IS NULL AND storage_state = 'NONE' AND
      storage_object_key IS NULL AND storage_staging_key IS NULL AND upload_idempotency_key IS NULL AND
      upload_request_sha256 IS NULL) OR
    (evidence_type IN ('UPLOAD', 'SCREENSHOT') AND original_file_name IS NOT NULL AND
      content_type IS NOT NULL AND file_size IS NOT NULL AND file_sha256 IS NOT NULL AND
      evidence_url IS NULL AND integration_provider IS NULL AND integration_reference IS NULL AND
      (evidence_type <> 'SCREENSHOT' OR content_type IN ('image/png', 'image/jpeg', 'image/webp')) AND
      ((storage_state = 'FINALIZING' AND storage_object_key LIKE 'obj-%' AND
        storage_staging_key LIKE 'stage-%' AND upload_idempotency_key IS NOT NULL AND
        upload_request_sha256 IS NOT NULL) OR
       (storage_state = 'READY' AND storage_object_key LIKE 'obj-%' AND
        storage_staging_key IS NULL AND upload_idempotency_key IS NOT NULL AND
        upload_request_sha256 IS NOT NULL))) OR
    (evidence_type = 'INTEGRATION' AND integration_provider IS NOT NULL AND
      integration_reference IS NOT NULL AND evidence_url IS NULL AND original_file_name IS NULL AND
      content_type IS NULL AND file_size IS NULL AND file_sha256 IS NULL AND storage_state = 'NONE' AND
      storage_object_key IS NULL AND storage_staging_key IS NULL AND upload_idempotency_key IS NULL AND
      upload_request_sha256 IS NULL)
  );

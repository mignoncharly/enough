DO $migration$
DECLARE active_seconds_constraint text;
BEGIN
  SELECT conname INTO active_seconds_constraint
  FROM pg_constraint
  WHERE conrelid = 'enough.build_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%active_seconds%';
  IF active_seconds_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE enough.build_sessions DROP CONSTRAINT %I', active_seconds_constraint);
  END IF;
END
$migration$;

ALTER TABLE enough.build_sessions
  RENAME COLUMN active_seconds TO active_milliseconds;

ALTER TABLE enough.build_sessions
  ALTER COLUMN active_milliseconds TYPE bigint
  USING active_milliseconds::bigint * 1000;

ALTER TABLE enough.build_sessions
  ADD CONSTRAINT build_sessions_active_milliseconds_check
  CHECK (active_milliseconds >= 0 AND active_milliseconds <= reserved_minutes * 60000);

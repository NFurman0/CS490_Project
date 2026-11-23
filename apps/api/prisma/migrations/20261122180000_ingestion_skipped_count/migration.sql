ALTER TABLE ingestion_runs
  ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ingestion_runs
  ADD CONSTRAINT ingestion_runs_skipped_count_nonnegative_check
  CHECK (skipped_count >= 0);

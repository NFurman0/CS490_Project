CREATE TYPE ingestion_run_status AS ENUM ('running', 'succeeded', 'failed');

CREATE TYPE ingestion_error_code AS ENUM (
  'SOURCE_UNRESOLVABLE',
  'SOURCE_NO_REVIEWS',
  'PROVIDER_TIMEOUT',
  'PROVIDER_QUOTA_EXHAUSTED',
  'PROVIDER_ERROR'
);

CREATE TABLE ingestion_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  status ingestion_run_status NOT NULL,
  error_code ingestion_error_code,
  review_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id),
  CONSTRAINT ingestion_runs_target_id_fkey
    FOREIGN KEY (target_id) REFERENCES analysis_targets(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ingestion_runs_review_count_nonnegative_check
    CHECK (review_count >= 0),
  CONSTRAINT ingestion_runs_failed_has_error_code_check
    CHECK (status <> 'failed' OR error_code IS NOT NULL),
  CONSTRAINT ingestion_runs_finished_has_completed_at_check
    CHECK (status = 'running' OR completed_at IS NOT NULL)
);

CREATE INDEX ingestion_runs_target_id_started_at_idx
  ON ingestion_runs(target_id, started_at DESC);

ALTER TYPE ingestion_error_code ADD VALUE 'PERSISTENCE_ERROR';

CREATE TABLE reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  source_review_id TEXT,
  text TEXT NOT NULL,
  rating DOUBLE PRECISION NOT NULL,
  reviewer_name TEXT,
  published_at TEXT,
  review_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_target_id_fkey FOREIGN KEY (target_id)
    REFERENCES analysis_targets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT reviews_rating_range_check CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX reviews_target_id_idx ON reviews(target_id);

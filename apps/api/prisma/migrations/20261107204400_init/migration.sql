CREATE TYPE review_platform AS ENUM ('google_maps');

CREATE TABLE users (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX users_clerk_user_id_key
  ON users(clerk_user_id);

CREATE TABLE analysis_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  platform review_platform NOT NULL,
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT analysis_targets_pkey PRIMARY KEY (id),
  CONSTRAINT analysis_targets_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT analysis_targets_name_nonempty_check
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT analysis_targets_source_url_nonempty_check
    CHECK (length(btrim(source_url)) > 0)
);

CREATE INDEX analysis_targets_owner_id_created_at_idx
  ON analysis_targets(owner_id, created_at DESC);

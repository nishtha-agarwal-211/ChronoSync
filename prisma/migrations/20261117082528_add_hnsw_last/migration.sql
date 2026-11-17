-- This is an empty migration.
CREATE INDEX IF NOT EXISTS "state_snapshots_embedding_hnsw_idx"
ON "state_snapshots" USING hnsw ("embedding_vector" vector_cosine_ops);

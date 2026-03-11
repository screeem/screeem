-- Test: pgvector index creation
-- Reference: pgvector documentation for IVFFlat and HNSW indexes

-- IVFFlat index for L2 distance
CREATE INDEX ON items USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

-- HNSW index for cosine distance
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);

-- HNSW index with parameters
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- IVFFlat index for inner product
CREATE INDEX ON items USING ivfflat (embedding vector_ip_ops) WITH (lists = 100);

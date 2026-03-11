-- Test: pgvector query patterns
-- Reference: common pgvector usage patterns

-- Insert with vector literal
INSERT INTO items (embedding) VALUES ('[1,2,3]');

-- Insert with array cast
INSERT INTO items (embedding) VALUES (ARRAY[1,2,3]::VECTOR(3));

-- Nearest neighbor search with WHERE clause
SELECT id, content, embedding <-> '[3,1,2]' AS distance
FROM items
WHERE category = 'articles'
ORDER BY embedding <-> '[3,1,2]'
LIMIT 10;

-- Cosine similarity (1 - cosine distance)
SELECT id, 1 - (embedding <=> '[3,1,2]') AS cosine_similarity
FROM items
ORDER BY embedding <=> '[3,1,2]'
LIMIT 5;

-- Set ivfflat probes
SET ivfflat.probes = 10;

-- Set HNSW ef_search
SET hnsw.ef_search = 200;

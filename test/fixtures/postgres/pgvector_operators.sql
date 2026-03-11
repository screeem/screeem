-- Test: pgvector distance operators
-- Reference: sqlfluff test/fixtures/dialects/postgres/postgres_pgvector_operators.sql

-- L2 distance
SELECT * FROM items ORDER BY embedding <-> '[3,1,2]' LIMIT 5;

-- Cosine distance
SELECT * FROM items ORDER BY embedding <=> '[3,1,2]' LIMIT 5;

-- L1 distance
SELECT * FROM items ORDER BY embedding <+> '[3,1,2]' LIMIT 5;

-- Inner product (negative)
SELECT * FROM items ORDER BY embedding <#> '[3,1,2]' LIMIT 5;

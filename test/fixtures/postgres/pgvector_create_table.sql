-- Test: CREATE TABLE with VECTOR type should be properly formatted
-- Reference: sqruff issue #2070 - VECTOR type indentation fix

CREATE TABLE IF NOT EXISTS msgs._all (
    bar VARCHAR NOT NULL,
    embd VECTOR(3072) DEFAULT NULL,
    baz VARCHAR
);

CREATE TABLE search (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content text NOT NULL,
    embedding VECTOR(1536)
);

CREATE TABLE multi_vector (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_embedding VECTOR(768) NOT NULL,
    content_embedding VECTOR(1536) DEFAULT NULL,
    summary_embedding VECTOR(384),
    metadata text
);

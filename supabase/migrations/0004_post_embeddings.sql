CREATE TABLE IF NOT EXISTS "post_embeddings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "post_content" text NOT NULL,
    "embedding" VECTOR(1536) DEFAULT NULL,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE post_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own embeddings" ON post_embeddings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own embeddings" ON post_embeddings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own embeddings" ON post_embeddings
  FOR DELETE USING (auth.uid() = user_id);

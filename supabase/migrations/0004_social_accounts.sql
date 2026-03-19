-- Create social_accounts table for many-per-user social network accounts
CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  handle text NOT NULL,
  label text,  -- optional friendly name, e.g. "Company account"
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('twitter', 'linkedin'));

-- Row Level Security
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own social accounts" ON social_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own social accounts" ON social_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own social accounts" ON social_accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own social accounts" ON social_accounts
  FOR DELETE USING (auth.uid() = user_id);

-- Migrate existing handles from profiles into social_accounts
INSERT INTO social_accounts (user_id, platform, handle)
SELECT id, 'twitter', twitter_handle
FROM profiles
WHERE twitter_handle IS NOT NULL AND twitter_handle != '';

INSERT INTO social_accounts (user_id, platform, handle)
SELECT id, 'linkedin', linkedin_handle
FROM profiles
WHERE linkedin_handle IS NOT NULL AND linkedin_handle != '';

-- Drop old columns from profiles
ALTER TABLE profiles DROP COLUMN twitter_handle;
ALTER TABLE profiles DROP COLUMN linkedin_handle;

-- Keep the account setup options aligned with the calendar's supported platforms.
ALTER TABLE social_accounts DROP CONSTRAINT social_accounts_platform_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('twitter', 'linkedin', 'instagram'));

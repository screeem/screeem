-- Migration: Initial Schema
-- Created: 2024-02-05

-- Event Store Tables

-- Event log (append-only) - ONLY for post scheduling events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  stream_id UUID NOT NULL,
  stream_type VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_version INTEGER DEFAULT 1,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL,
  sequence BIGSERIAL UNIQUE,
  stream_sequence INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_stream_sequence UNIQUE (stream_id, stream_sequence)
);

CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Snapshots for performance (optional optimization)
CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY,
  stream_id UUID UNIQUE NOT NULL,
  stream_type VARCHAR(50) NOT NULL,
  sequence INTEGER NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Traditional CRUD Tables

-- Users (synced from Supabase auth.users)
-- ID matches Supabase auth.users.id
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, -- References Supabase auth.users.id (not auto-generated)
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  version INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- Organization membership
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_org_user UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- Invitations
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);

-- Twitter accounts
CREATE TABLE IF NOT EXISTS twitter_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_name VARCHAR(255) NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  connected_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_org_twitter UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_twitter_accounts_org ON twitter_accounts(organization_id);

-- Scheduled posts (READ MODEL - projected from post events)
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  media_urls JSONB DEFAULT '[]',
  scheduled_for TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL,
  published_at TIMESTAMP,
  twitter_result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  version INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_org_time ON scheduled_posts(organization_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);

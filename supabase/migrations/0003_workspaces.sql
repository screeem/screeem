CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "workspace_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamp with time zone DEFAULT now(),
  UNIQUE ("workspace_id", "user_id")
);

-- Enable RLS on both tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Workspace policies: members can view workspaces they belong to
CREATE POLICY "Users can view workspaces they are members of" ON workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Owners can update their workspaces
CREATE POLICY "Owners can update their workspaces" ON workspaces
  FOR UPDATE USING (auth.uid() = owner_id);

-- Owners can delete their workspaces
CREATE POLICY "Owners can delete their workspaces" ON workspaces
  FOR DELETE USING (auth.uid() = owner_id);

-- Any authenticated user can create a workspace
CREATE POLICY "Authenticated users can create workspaces" ON workspaces
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Workspace members policies
CREATE POLICY "Members can view workspace members" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid())
  );

-- Only workspace owners can add members
CREATE POLICY "Workspace owners can add members" ON workspace_members
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

-- Workspace owners can remove members
CREATE POLICY "Workspace owners can remove members" ON workspace_members
  FOR DELETE USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

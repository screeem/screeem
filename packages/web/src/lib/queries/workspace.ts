import { createClient } from "@/lib/supabase/client";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export async function getWorkspaces(): Promise<Workspace[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createWorkspace(name: string, userId: string): Promise<Workspace> {
  const supabase = createClient();

  // Create the workspace
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({ name, owner_id: userId })
    .select()
    .single();

  if (workspaceError) throw workspaceError;

  // Add the creator as an owner member
  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) throw memberError;

  return workspace;
}

export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (error) throw error;
  return data ?? [];
}

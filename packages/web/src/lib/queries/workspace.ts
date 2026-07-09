import { createClient } from "@/lib/supabase/client";

export type Workspace = {
  id: string;
  owner_id: string;
  name: string;
  updated_at: string;
};

export type WorkspaceMember = {
  user_id: string;
  role: "owner" | "member";
};

export async function getWorkspace(userId: string): Promise<Workspace | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, owner_id, name, updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function updateWorkspaceName(
  workspaceId: string,
  name: string
): Promise<Workspace> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .select("id, owner_id, name, updated_at")
    .single();

  if (error) throw error;
  return data;
}

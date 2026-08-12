import { createClient } from "@/lib/supabase/client";

export type SocialAccount = {
  id: string;
  user_id: string;
  team_id: string;
  platform: "twitter" | "linkedin";
  handle: string;
  label: string | null;
};

export async function getSocialAccounts(teamId: string): Promise<SocialAccount[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, user_id, team_id, platform, handle, label")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addSocialAccount(account: {
    user_id: string;
    team_id: string;
  platform: string;
  handle: string;
  label?: string;
}): Promise<SocialAccount> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .insert(account)
    .select("id, user_id, team_id, platform, handle, label")
    .single();

  if (error) throw error;
  return data;
}

export async function updateSocialAccount(
  teamId: string,
  id: string,
  updates: { handle?: string; label?: string }
): Promise<SocialAccount> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .update(updates)
    .eq("team_id", teamId)
    .eq("id", id)
    .select("id, user_id, team_id, platform, handle, label")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSocialAccount(teamId: string, id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("team_id", teamId)
    .eq("id", id);

  if (error) throw error;
}

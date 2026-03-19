import { createClient } from "@/lib/supabase/client";

export type SocialAccount = {
  id: string;
  user_id: string;
  platform: "twitter" | "linkedin";
  handle: string;
  label: string | null;
};

export async function getSocialAccounts(userId: string): Promise<SocialAccount[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, user_id, platform, handle, label")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addSocialAccount(account: {
  user_id: string;
  platform: string;
  handle: string;
  label?: string;
}): Promise<SocialAccount> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .insert(account)
    .select("id, user_id, platform, handle, label")
    .single();

  if (error) throw error;
  return data;
}

export async function updateSocialAccount(
  id: string,
  updates: { handle?: string; label?: string }
): Promise<SocialAccount> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .update(updates)
    .eq("id", id)
    .select("id, user_id, platform, handle, label")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSocialAccount(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

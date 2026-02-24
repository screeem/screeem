import { createClient } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  twitter_handle: string | null;
  linkedin_handle: string | null;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, twitter_handle, linkedin_handle")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // no row found
    throw error;
  }
  return data;
}

export async function upsertProfile(profile: {
  id: string;
  twitter_handle: string;
  linkedin_handle: string;
}): Promise<Profile> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select("id, twitter_handle, linkedin_handle")
    .single();

  if (error) throw error;
  return data;
}

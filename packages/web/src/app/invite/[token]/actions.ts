"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_TEAM_COOKIE } from "@/lib/teams/server";

export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const admin = createAdminClient();
  const { data: invitation } = await admin.from("team_invitations").select("id, team_id, email, role, expires_at").eq("token", token).maybeSingle();
  if (!invitation || new Date(invitation.expires_at) <= new Date()) throw new Error("This invitation has expired");
  if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) throw new Error("This invitation was sent to a different email address");

  const { error } = await admin.from("team_members").upsert({ team_id: invitation.team_id, user_id: user.id, role: invitation.role }, { onConflict: "team_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await admin.from("team_invitations").delete().eq("id", invitation.id);
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, invitation.team_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

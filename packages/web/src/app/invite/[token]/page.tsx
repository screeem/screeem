import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "./actions";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const admin = createAdminClient();
  const { data: invitation } = await admin.from("team_invitations").select("email, role, expires_at, teams(name)").eq("token", token).maybeSingle();
  const valid = invitation && new Date(invitation.expires_at) > new Date();
  const teamValue = invitation?.teams as unknown as { name: string } | { name: string }[] | null;
  const teamName = Array.isArray(teamValue) ? teamValue[0]?.name : teamValue?.name;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-lg font-semibold">Screeem</div>
        {!valid ? (
          <><h1 className="text-xl font-semibold text-gray-900">Invitation unavailable</h1><p className="mt-2 text-sm text-gray-500">This invitation is invalid or has expired.</p></>
        ) : invitation.email.toLowerCase() !== user.email?.toLowerCase() ? (
          <><h1 className="text-xl font-semibold text-gray-900">Wrong account</h1><p className="mt-2 text-sm text-gray-500">This invitation was sent to {invitation.email}. Sign in with that address to accept it.</p></>
        ) : (
          <><h1 className="text-xl font-semibold text-gray-900">Join {teamName ?? "this team"}</h1><p className="mt-2 text-sm text-gray-500">You’ll join as {invitation.role === "admin" ? "an admin" : "a member"} and share access to its connected social accounts.</p><form action={acceptInvitation} className="mt-6"><input type="hidden" name="token" value={token} /><button className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700">Accept invitation</button></form></>
        )}
      </div>
    </main>
  );
}

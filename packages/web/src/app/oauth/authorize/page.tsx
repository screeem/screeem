import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConsentForm } from "./ConsentForm";
import { getUserTeams } from "@/lib/teams/server";

interface SearchParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8">
        <h1 className="text-xl font-semibold text-error-text mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
  } = params;

  if (
    response_type !== "code" ||
    !client_id ||
    !redirect_uri ||
    !code_challenge
  ) {
    return (
      <ErrorPage
        title="Invalid Request"
        message="Missing or invalid OAuth parameters."
      />
    );
  }

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", client_id)
    .single();

  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    return (
      <ErrorPage
        title="Invalid Client"
        message="Unknown client ID or unauthorized redirect URI."
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const filteredEntries = Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== ""
    ) as [string, string][];
    const returnTo = `/oauth/authorize?${new URLSearchParams(filteredEntries).toString()}`;
    redirect(`/auth/login?next=${encodeURIComponent(returnTo)}`);
  }

  const teams = await getUserTeams(user.id, user.email);

  return (
    <ConsentForm
      clientName={client.client_name ?? client_id}
      clientId={client_id}
      redirectUri={redirect_uri}
      state={state ?? ""}
      codeChallenge={code_challenge}
      userId={user.id}
      teams={teams}
    />
  );
}

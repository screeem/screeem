import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveTeam } from "@/lib/teams/server";

export const getDashboardSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { activeTeam, teams } = await getActiveTeam(user.id, user.email);
  return { user, activeTeam, teams };
});

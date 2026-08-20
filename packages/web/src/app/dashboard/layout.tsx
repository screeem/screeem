import Link from "next/link";
import { DashboardNav } from "./DashboardNav";
import { SignOutButton } from "./SignOutButton";
import { TeamSwitcher } from "./TeamSwitcher";
import { getDashboardSession } from "@/lib/dashboard/server";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, activeTeam, teams } = await getDashboardSession();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="font-semibold text-foreground">Screeem</Link>
            <TeamSwitcher teams={teams} activeTeamId={activeTeam.id} />
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/user"
              aria-label="User settings"
              title="User settings"
              className="max-w-48 truncate rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {user.email}
            </Link>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4">
          <DashboardNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

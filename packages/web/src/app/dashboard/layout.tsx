import Link from "next/link";
import { DashboardNav } from "./DashboardNav";
import { SignOutButton } from "./SignOutButton";
import { TeamSwitcher } from "./TeamSwitcher";
import { getDashboardSession } from "@/lib/dashboard/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, activeTeam, teams } = await getDashboardSession();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="font-semibold text-gray-900">Screeem</Link>
            <TeamSwitcher teams={teams} activeTeamId={activeTeam.id} />
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/user"
              aria-label="User settings"
              title="User settings"
              className="max-w-48 truncate rounded-md px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {user.email}
            </Link>
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

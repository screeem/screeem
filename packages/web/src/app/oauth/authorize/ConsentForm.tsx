"use client";

import { approveAuthorization, denyAuthorization } from "./actions";
import type { UserTeam } from "@/lib/teams/server";

interface Props {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  userId: string;
  teams: UserTeam[];
}

export function ConsentForm({
  clientName,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  userId,
  teams,
}: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-bold text-sm">S</span>
          </div>
          <span className="text-lg font-semibold text-foreground">Screeem</span>
        </div>

        <h1 className="text-xl font-semibold text-foreground mb-2">
          Authorize <span className="text-foreground">{clientName}</span>
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          <strong className="text-foreground">{clientName}</strong> is requesting
          access to a Screeem team to create and preview social media
          posts on your behalf.
        </p>

        <div className="bg-muted rounded-lg border border-border p-4 mb-6">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            This will allow
          </p>
          <ul className="space-y-1 text-sm text-foreground">
            <li className="flex items-center gap-2">
              <span className="text-success-text">✓</span>
              Create and update social posts
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success-text">✓</span>
              Access your profile (Twitter/LinkedIn handles)
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <form action={approveAuthorization}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="redirectUri" value={redirectUri} />
            <input type="hidden" name="state" value={state} />
            <input type="hidden" name="codeChallenge" value={codeChallenge} />
            <label className="mb-4 block text-sm font-medium text-foreground">
              Team
              <select name="teamId" className="mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2 text-sm">
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
            >
              Allow access
            </button>
          </form>

          <form action={denyAuthorization}>
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="redirectUri" value={redirectUri} />
            <input type="hidden" name="state" value={state} />
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-card text-foreground text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

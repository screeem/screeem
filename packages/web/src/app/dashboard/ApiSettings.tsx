"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionCard } from "@/components/ui/section-card";

type PublicApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "Something went wrong";
}

export function ApiSettings({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const query = useQuery({
    queryKey: ["public-api-keys", teamId],
    queryFn: async () => {
      const response = await fetch(`/api/teams/${teamId}/api-keys`);
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json() as { keys: PublicApiKey[] };
      return body.keys;
    },
    enabled: canManage,
  });

  const createKey = useMutation({
    mutationFn: async (keyName: string) => {
      const response = await fetch(`/api/teams/${teamId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<{ key: PublicApiKey; secret: string }>;
    },
    onSuccess: ({ secret }) => {
      setName("");
      setNewSecret(secret);
      queryClient.invalidateQueries({ queryKey: ["public-api-keys", teamId] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const response = await fetch(`/api/teams/${teamId}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readError(response));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["public-api-keys", teamId] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) createKey.mutate(name.trim());
  }

  function copySecret() {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-8 space-y-6">
      <SectionCard
        title="API definition"
        description="The OpenAPI 3.1 definition can be imported into SDK generators and API clients."
      >
        <div className="flex items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-sm">
            /api/openapi
          </code>
          <Button asChild variant="outline">
            <a href="/api/openapi" target="_blank" rel="noopener noreferrer">
              View definition
            </a>
          </Button>
          <Button asChild>
            <a href="/api/openapi" download="openapi.json">
              Download
            </a>
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Public API keys"
        description={
          <>
            Send a key as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
            Secrets are shown only once.
          </>
        }
      >

        {!canManage ? (
          <p className="text-sm text-muted-foreground">Only team owners and admins can manage API keys.</p>
        ) : (
          <>
            <form onSubmit={submit} className="flex max-w-xl gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="Key name, e.g. Production"
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={!name.trim() || createKey.isPending}>
                {createKey.isPending ? "Creating…" : "Create key"}
              </Button>
            </form>

            {createKey.error && (
              <Notice tone="error" className="mt-3">
                {createKey.error.message}
              </Notice>
            )}

            {newSecret && (
              <Notice tone="warning" role={undefined} className="mt-4">
                <p className="font-medium">Copy this key now. It won&apos;t be shown again.</p>
                <div className="mt-2 flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-card px-3 py-2 font-mono text-sm text-foreground">
                    {newSecret}
                  </code>
                  <Button variant="outline" size="sm" onClick={copySecret}>
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setNewSecret(null)}>
                    Done
                  </Button>
                </div>
              </Notice>
            )}

            <div className="mt-6 divide-y divide-border">
              {query.isLoading && <p className="py-4 text-sm text-muted-foreground">Loading keys…</p>}
              {query.error && <p className="py-4 text-sm text-error-text">{query.error.message}</p>}
              {query.data?.length === 0 && <p className="py-4 text-sm text-muted-foreground">No public API keys yet.</p>}
              {query.data?.map((key) => (
                <div key={key.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <code>{key.key_prefix}</code> · Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at ? ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}` : " · Never used"}
                    </p>
                  </div>
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    onClick={() => revokeKey.mutate(key.id)}
                    disabled={revokeKey.isPending}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

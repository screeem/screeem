"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">API definition</h2>
        <p className="mt-1 text-sm text-gray-500">
          The OpenAPI 3.1 definition can be imported into SDK generators and API clients.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            /api/openapi
          </code>
          <a
            href="/api/openapi"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
          >
            View definition
          </a>
          <a
            href="/api/openapi"
            download="openapi.json"
            className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-700"
          >
            Download
          </a>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Public API keys</h2>
        <p className="mt-1 text-sm text-gray-500">
          Send a key as <code>Authorization: Bearer &lt;key&gt;</code>. Secrets are shown only once.
        </p>

        {!canManage ? (
          <p className="mt-4 text-sm text-amber-700">Only team owners and admins can manage API keys.</p>
        ) : (
          <>
            <form onSubmit={submit} className="mt-5 flex max-w-xl gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="Key name, e.g. Production"
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-gray-900"
              />
              <button
                type="submit"
                disabled={!name.trim() || createKey.isPending}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {createKey.isPending ? "Creating…" : "Create key"}
              </button>
            </form>

            {createKey.error && <p className="mt-2 text-sm text-red-600">{createKey.error.message}</p>}

            {newSecret && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">Copy this key now. It won&apos;t be shown again.</p>
                <div className="mt-2 flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded border border-amber-200 bg-white px-3 py-2 text-sm">
                    {newSecret}
                  </code>
                  <button onClick={copySecret} className="rounded border border-amber-300 px-3 py-2 text-sm hover:bg-amber-100">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button onClick={() => setNewSecret(null)} className="rounded border border-amber-300 px-3 py-2 text-sm hover:bg-amber-100">
                    Done
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 divide-y divide-gray-100">
              {query.isLoading && <p className="py-4 text-sm text-gray-500">Loading keys…</p>}
              {query.error && <p className="py-4 text-sm text-red-600">{query.error.message}</p>}
              {query.data?.length === 0 && <p className="py-4 text-sm text-gray-500">No public API keys yet.</p>}
              {query.data?.map((key) => (
                <div key={key.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{key.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      <code>{key.key_prefix}</code> · Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at ? ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}` : " · Never used"}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeKey.mutate(key.id)}
                    disabled={revokeKey.isPending}
                    className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

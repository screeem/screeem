"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Notice } from "@/components/ui/notice";

async function fetchApiKey(): Promise<string> {
  const res = await fetch("/api/profile/api-key");
  if (!res.ok) throw new Error("Failed to fetch API key");
  const data = await res.json();
  return data.key as string;
}

async function regenerateApiKey(): Promise<string> {
  const res = await fetch("/api/profile/api-key", { method: "POST" });
  if (!res.ok) throw new Error("Failed to regenerate API key");
  const data = await res.json();
  return data.key as string;
}

type Tab = "claude-ai" | "desktop";

export function McpSetup({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("claude-ai");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const { data: apiKey, isLoading } = useQuery({
    queryKey: ["api-key", teamId],
    queryFn: fetchApiKey,
  });

  const mutation = useMutation({
    mutationFn: regenerateApiKey,
    onSuccess: (newKey) => {
      queryClient.setQueryData(["api-key", teamId], newKey);
      setRevealed(true);
    },
  });

  const maskedKey = apiKey
    ? apiKey.slice(0, 8) + "••••••••••••••••••••••••••••"
    : "";

  const displayKey = revealed ? apiKey ?? "" : maskedKey;

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const mcpUrl = `${baseUrl}/api/mcp`;

  const configJson = JSON.stringify(
    {
      mcpServers: {
        screeem: {
          command: "npx",
          args: [
            "mcp-remote",
            mcpUrl,
            "--header",
            `Authorization: Bearer ${apiKey ?? "<your-api-key>"}`,
          ],
        },
      },
    },
    null,
    2
  );

  function copyKey() {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyUrl() {
    navigator.clipboard.writeText(mcpUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  }

  return (
    <div className="bg-card rounded-lg border border-border mt-6">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground mb-1">Connect to Claude</h2>
        <p className="text-sm text-muted-foreground">
          Use the Screeem MCP server to draft, preview, schedule, and manage social posts in any conversation.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("claude-ai")}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === "claude-ai"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Claude.ai
        </button>
        <button
          onClick={() => setTab("desktop")}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === "desktop"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Claude Desktop
        </button>
      </div>

      <div className="p-6">
        {tab === "claude-ai" && (
          <div>
            <p className="text-sm text-muted-foreground mb-6">
              Add Screeem as a custom connector on Claude.ai. Claude will prompt you to
              sign in and authorize access automatically.
            </p>

            {/* MCP URL */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-foreground mb-2">
                Connector URL
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
                  {mcpUrl}
                </code>
                <Button variant="outline" size="sm" onClick={copyUrl}>
                  {urlCopied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>

            {/* Steps */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Setup Instructions</h3>
              <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                <li>
                  Open{" "}
                  <a
                    href="https://claude.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    claude.ai
                  </a>{" "}
                  and go to{" "}
                  <strong>Settings → Customize → Connectors</strong>.
                </li>
                <li>
                  Click <strong>+</strong> to add a new custom connector.
                </li>
                <li>
                  Enter a name (e.g. <em>Screeem</em>) and paste the Connector URL above.
                </li>
                <li>
                  Click <strong>Save</strong>. Claude will redirect you to sign in and
                  authorize access.
                </li>
                <li>
                  In any conversation, ask Claude to open or update your calendar — e.g.,{" "}
                  <em>&ldquo;Open my content calendar and schedule a launch post for Friday&rdquo;</em>.
                </li>
              </ol>
            </div>
          </div>
        )}

        {tab === "desktop" && (
          <div>
            <p className="text-sm text-muted-foreground mb-6">
              Use the Screeem MCP server with Claude Desktop via your API key.
            </p>

            {/* API Key */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-foreground mb-2">
                Your API Key
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
                  {isLoading ? "Loading…" : displayKey}
                </code>
                <Button variant="outline" size="sm" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? "Hide" : "Reveal"}
                </Button>
                <Button variant="outline" size="sm" onClick={copyKey} disabled={isLoading}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || isLoading}
                >
                  {mutation.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
              </div>
              {mutation.isSuccess && (
                <Notice tone="warning" className="mt-2 py-2 text-xs">
                  Key regenerated. Update your Claude Desktop config.
                </Notice>
              )}
            </div>

            {/* Config snippet */}
            <CodeBlock
              className="mb-6"
              label="Claude Desktop Config"
              disabled={isLoading}
              code={isLoading ? "Loading…" : configJson}
            />

            {/* Setup steps */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">
                Setup Instructions
              </h3>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                <li>Copy the config above.</li>
                <li>
                  Open your Claude Desktop config file:
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-muted-foreground">
                    <li>
                      <strong>Mac:</strong>{" "}
                      <code className="text-xs bg-muted px-1 rounded">
                        ~/Library/Application Support/Claude/claude_desktop_config.json
                      </code>
                    </li>
                    <li>
                      <strong>Windows:</strong>{" "}
                      <code className="text-xs bg-muted px-1 rounded">
                        %APPDATA%\Claude\claude_desktop_config.json
                      </code>
                    </li>
                  </ul>
                </li>
                <li>
                  Merge the{" "}
                  <code className="text-xs bg-muted px-1 rounded">mcpServers</code>{" "}
                  block into the file (create the file if it doesn&apos;t exist).
                </li>
                <li>Restart Claude Desktop.</li>
                <li>
                  In a new conversation, ask Claude to draft a post — e.g.,{" "}
                  <em>&ldquo;Draft me a tweet about shipping a new feature&rdquo;</em> — and Claude will use the{" "}
                  <code className="text-xs bg-muted px-1 rounded">create_or_update_post</code> tool.
                </li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

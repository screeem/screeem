"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export function McpSetup() {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);

  const { data: apiKey, isLoading } = useQuery({
    queryKey: ["api-key"],
    queryFn: fetchApiKey,
  });

  const mutation = useMutation({
    mutationFn: regenerateApiKey,
    onSuccess: (newKey) => {
      queryClient.setQueryData(["api-key"], newKey);
      setRevealed(true);
    },
  });

  const maskedKey = apiKey
    ? apiKey.slice(0, 8) + "••••••••••••••••••••••••••••"
    : "";

  const displayKey = revealed ? apiKey ?? "" : maskedKey;

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const configJson = JSON.stringify(
    {
      mcpServers: {
        screeem: {
          url: `${baseUrl}/api/mcp`,
          headers: {
            Authorization: `Bearer ${apiKey ?? "<your-api-key>"}`,
          },
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

  function copyConfig() {
    navigator.clipboard.writeText(configJson);
    setConfigCopied(true);
    setTimeout(() => setConfigCopied(false), 2000);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Claude Desktop Setup
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Use the Screeem MCP server with Claude Desktop to draft and preview
        social posts in any conversation.
      </p>

      {/* API Key */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your API Key
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm font-mono text-gray-800 overflow-hidden text-ellipsis whitespace-nowrap">
            {isLoading ? "Loading…" : displayKey}
          </code>
          <button
            onClick={() => setRevealed((r) => !r)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button
            onClick={copyKey}
            disabled={isLoading}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || isLoading}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 text-red-600"
          >
            {mutation.isPending ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
        {mutation.isSuccess && (
          <p className="text-xs text-amber-600 mt-1">
            Key regenerated. Update your Claude Desktop config.
          </p>
        )}
      </div>

      {/* Config snippet */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">
            Claude Desktop Config
          </label>
          <button
            onClick={copyConfig}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {configCopied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="bg-gray-50 border border-gray-200 rounded-md p-4 text-xs font-mono text-gray-800 overflow-x-auto whitespace-pre">
          {isLoading ? "Loading…" : configJson}
        </pre>
      </div>

      {/* Setup steps */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          Setup Instructions
        </h3>
        <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
          <li>Copy the config above.</li>
          <li>
            Open your Claude Desktop config file:
            <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-gray-500">
              <li>
                <strong>Mac:</strong>{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">
                  ~/Library/Application Support/Claude/claude_desktop_config.json
                </code>
              </li>
              <li>
                <strong>Windows:</strong>{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">
                  %APPDATA%\Claude\claude_desktop_config.json
                </code>
              </li>
            </ul>
          </li>
          <li>
            Merge the <code className="text-xs bg-gray-100 px-1 rounded">mcpServers</code> block into the file (create the file if it doesn&apos;t exist).
          </li>
          <li>Restart Claude Desktop.</li>
          <li>
            In a new conversation, ask Claude to draft a post — e.g.,{" "}
            <em>&ldquo;Draft me a tweet about shipping a new feature&rdquo;</em> — and Claude will use the{" "}
            <code className="text-xs bg-gray-100 px-1 rounded">create_or_update_post</code> tool.
          </li>
        </ol>
      </div>
    </div>
  );
}

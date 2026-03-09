"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

async function fetchWorkspaces(): Promise<Workspace[]> {
  const res = await fetch("/api/workspaces");
  if (!res.ok) throw new Error("Failed to fetch workspaces");
  const data = await res.json();
  return data.workspaces;
}

async function createWorkspace(name: string): Promise<Workspace> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create workspace");
  }
  const data = await res.json();
  return data.workspace;
}

export function WorkspaceList() {
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const mutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setName("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      mutation.mutate(name.trim());
    }
  };

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspaces</h2>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workspace name"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? "Creating..." : "Create Workspace"}
        </button>
      </form>

      {mutation.isError && (
        <p className="text-sm text-red-600 mb-4">{mutation.error.message}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading workspaces...</p>
      ) : workspaces && workspaces.length > 0 ? (
        <ul className="space-y-2">
          {workspaces.map((workspace) => (
            <li
              key={workspace.id}
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md"
            >
              <div>
                <span className="font-medium text-gray-900">{workspace.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {new Date(workspace.created_at).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No workspaces yet. Create one above.</p>
      )}
    </div>
  );
}

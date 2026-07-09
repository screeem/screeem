"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getWorkspace,
  getWorkspaceMembers,
  updateWorkspaceName,
} from "@/lib/queries/workspace";

export function WorkspaceSettings({ userId, userEmail }: { userId: string; userEmail: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const workspaceQuery = useQuery({
    queryKey: ["workspace", userId],
    queryFn: () => getWorkspace(userId),
  });
  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceQuery.data?.id],
    queryFn: () => getWorkspaceMembers(workspaceQuery.data!.id),
    enabled: Boolean(workspaceQuery.data?.id),
  });

  useEffect(() => {
    if (workspaceQuery.data) setName(workspaceQuery.data.name);
  }, [workspaceQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateWorkspaceName(workspaceQuery.data!.id, name),
    onSuccess: (workspace) => {
      queryClient.setQueryData(["workspace", userId], workspace);
    },
  });

  const workspace = workspaceQuery.data;
  const members = membersQuery.data ?? [];

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Workspace settings</h2>
      <p className="text-sm text-gray-500 mb-6">
        Your personal workspace keeps your connected accounts and settings separate from other users.
      </p>

      {workspaceQuery.isLoading ? (
        <p className="text-sm text-gray-500">Loading workspace...</p>
      ) : workspace ? (
        <div className="max-w-lg space-y-6">
          <div>
            <label htmlFor="workspace-name" className="block text-sm font-medium text-gray-700 mb-2">
              Workspace name
            </label>
            <div className="flex gap-2">
              <input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!name.trim() || name.trim() === workspace.name || saveMutation.isPending}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
            {saveMutation.isError && <p className="text-xs text-red-600 mt-2">Could not save workspace name.</p>}
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Users</h3>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {member.user_id === userId ? userEmail : "Workspace user"}
                    </p>
                    <p className="text-xs text-gray-500">{member.user_id === userId ? "You" : member.user_id}</p>
                  </div>
                  <span className="text-xs text-gray-500 capitalize">{member.role}</span>
                </div>
              ))}
              {members.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">No users found.</p>}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-red-600">Your workspace is not available yet. Refresh after applying the latest database migration.</p>
      )}
    </section>
  );
}

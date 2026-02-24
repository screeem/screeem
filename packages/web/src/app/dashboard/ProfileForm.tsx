"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfile, upsertProfile } from "@/lib/queries/profile";

export function ProfileForm({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [twitter, setTwitter] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => getProfile(userId),
  });

  useEffect(() => {
    if (data) {
      setTwitter(data.twitter_handle ?? "");
      setLinkedin(data.linkedin_handle ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      upsertProfile({
        id: userId,
        twitter_handle: twitter.replace(/^@/, ""),
        linkedin_handle: linkedin,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile", userId], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Twitter / X
          </label>
          <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent">
            <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r border-gray-300">
              @
            </span>
            <input
              type="text"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              placeholder="handle"
              className="flex-1 px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            LinkedIn
          </label>
          <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent">
            <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r border-gray-300">
              linkedin.com/in/
            </span>
            <input
              type="text"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="handle"
              className="flex-1 px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span className="text-sm text-green-600">Saved ✓</span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSocialAccounts,
  addSocialAccount,
  deleteSocialAccount,
  type SocialAccount,
} from "@/lib/queries/profile";

type Platform = "twitter" | "linkedin";

const PLATFORM_CONFIG: Record<
  Platform,
  { name: string; prefix: string; placeholder: string; urlBase: string; avatarBase: string }
> = {
  twitter: {
    name: "Twitter / X",
    prefix: "@",
    placeholder: "handle",
    urlBase: "https://x.com/",
    avatarBase: "https://unavatar.io/twitter/",
  },
  linkedin: {
    name: "LinkedIn",
    prefix: "linkedin.com/in/",
    placeholder: "handle",
    urlBase: "https://linkedin.com/in/",
    avatarBase: "https://unavatar.io/linkedin/",
  },
};

function AccountCard({
  account,
  onDelete,
  isDeleting,
}: {
  account: SocialAccount;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const config = PLATFORM_CONFIG[account.platform];
  return (
    <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <img
        src={`${config.avatarBase}${account.handle}`}
        alt={account.handle}
        className="w-10 h-10 rounded-full bg-gray-200"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">
          {config.prefix}
          {account.handle}
        </p>
        {account.label && (
          <p className="text-xs text-gray-500 truncate">{account.label}</p>
        )}
        <a
          href={`${config.urlBase}${account.handle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline"
        >
          {config.urlBase.replace("https://", "")}
          {account.handle}
        </a>
      </div>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

function AddAccountForm({
  platform,
  userId,
  onAdded,
}: {
  platform: Platform;
  userId: string;
  onAdded: () => void;
}) {
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const config = PLATFORM_CONFIG[platform];

  const mutation = useMutation({
    mutationFn: () =>
      addSocialAccount({
        user_id: userId,
        platform,
        handle: handle.replace(/^@/, ""),
        ...(label ? { label } : {}),
      }),
    onSuccess: () => {
      setHandle("");
      setLabel("");
      onAdded();
    },
  });

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <div className="flex items-center border border-gray-300 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent">
          <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r border-gray-300 whitespace-nowrap">
            {config.prefix}
          </span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={config.placeholder}
            className="flex-1 px-3 py-2 text-sm outline-none min-w-0"
          />
        </div>
      </div>
      <div className="w-36">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={!handle.trim() || mutation.isPending}
        className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        {mutation.isPending ? "Adding..." : "Add"}
      </button>
    </div>
  );
}

function PlatformSection({
  platform,
  accounts,
  userId,
  onChanged,
  deletingId,
  onDelete,
}: {
  platform: Platform;
  accounts: SocialAccount[];
  userId: string;
  onChanged: () => void;
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  const config = PLATFORM_CONFIG[platform];
  const platformAccounts = accounts.filter((a) => a.platform === platform);

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-3">{config.name}</h3>
      {platformAccounts.length > 0 && (
        <div className="space-y-2 mb-3">
          {platformAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onDelete={() => onDelete(account.id)}
              isDeleting={deletingId === account.id}
            />
          ))}
        </div>
      )}
      <AddAccountForm platform={platform} userId={userId} onAdded={onChanged} />
    </div>
  );
}

export function ProfileForm({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["social-accounts", userId],
    queryFn: () => getSocialAccounts(userId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["social-accounts", userId] });
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteSocialAccount(id);
      invalidate();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Connected Accounts
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Add your social media accounts. You can connect multiple accounts per platform.
      </p>

      <div className="space-y-8 max-w-lg">
        <PlatformSection
          platform="twitter"
          accounts={accounts}
          userId={userId}
          onChanged={invalidate}
          deletingId={deletingId}
          onDelete={handleDelete}
        />
        <PlatformSection
          platform="linkedin"
          accounts={accounts}
          userId={userId}
          onChanged={invalidate}
          deletingId={deletingId}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}

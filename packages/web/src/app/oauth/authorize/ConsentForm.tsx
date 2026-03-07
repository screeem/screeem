"use client";

import { approveAuthorization, denyAuthorization } from "./actions";

interface Props {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  userId: string;
}

export function ConsentForm({
  clientName,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  userId,
}: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-lg font-semibold text-gray-900">Screeem</span>
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Authorize <span className="text-gray-700">{clientName}</span>
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          <strong className="text-gray-700">{clientName}</strong> is requesting
          access to your Screeem account to create and preview social media
          posts on your behalf.
        </p>

        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mb-6">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            This will allow
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Create and update social posts
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
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
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
            >
              Allow access
            </button>
          </form>

          <form action={denyAuthorization}>
            <input type="hidden" name="redirectUri" value={redirectUri} />
            <input type="hidden" name="state" value={state} />
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

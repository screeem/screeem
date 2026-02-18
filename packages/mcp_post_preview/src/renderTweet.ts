export interface TweetData {
  displayName: string;
  handle: string;
  text: string;
  avatarUrl?: string;
  imageUrl?: string;
  verified?: boolean;
  timestamp?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

/**
 * Renders tweet text with clickable hashtags, @mentions, and links.
 */
function renderTweetText(text: string): string {
  let html = escapeHtml(text);

  // URLs
  html = html.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" class="text-sky-500 hover:underline">$1</a>'
  );

  // @mentions
  html = html.replace(
    /@(\w+)/g,
    '<a href="#" class="text-sky-500 hover:underline">@$1</a>'
  );

  // #hashtags
  html = html.replace(
    /#(\w+)/g,
    '<a href="#" class="text-sky-500 hover:underline">#$1</a>'
  );

  // Newlines
  html = html.replace(/\n/g, "<br>");

  return html;
}

const VERIFIED_SVG = `<svg viewBox="0 0 22 22" class="w-5 h-5 inline-block ml-0.5 fill-sky-500"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.144.271.592.706 1.092 1.246 1.448s1.173.552 1.813.568c.646-.016 1.273-.211 1.813-.567s.972-.854 1.246-1.44c.608.222 1.267.272 1.902.14.635-.13 1.22-.436 1.69-.882.445-.47.749-1.055.878-1.69.13-.634.08-1.29-.144-1.897.587-.274 1.087-.705 1.443-1.245.356-.54.555-1.17.574-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path></svg>`;

const DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 24 24" class="w-full h-full fill-gray-500"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>`;

/**
 * Renders a tweet as a full standalone HTML page
 * styled to match the Twitter/X post UI.
 */
export function renderTweetHtml(tweet: TweetData): string {
  const charCount = tweet.text.length;
  const charLimit = 280;
  const isOverLimit = charCount > charLimit;
  const charPercent = Math.min((charCount / charLimit) * 100, 100);

  const avatarHtml = tweet.avatarUrl
    ? `<img src="${escapeHtml(tweet.avatarUrl)}" alt="" class="w-10 h-10 rounded-full object-cover" />`
    : `<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">${DEFAULT_AVATAR_SVG}</div>`;

  const verifiedHtml = tweet.verified ? VERIFIED_SVG : "";

  const imageHtml = tweet.imageUrl
    ? `<div class="mt-3 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <img src="${escapeHtml(tweet.imageUrl)}" alt="" class="w-full object-cover max-h-[512px]" />
      </div>`
    : "";

  const timestamp = tweet.timestamp || new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }) + " · " + new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const textHtml = renderTweetText(tweet.text);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tweet Preview — @${escapeHtml(tweet.handle)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
    }
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  </style>
  <script>
    let lastVersion = 0;
    async function checkForUpdates() {
      try {
        const res = await fetch('/api/version');
        const data = await res.json();
        if (lastVersion > 0 && data.version !== lastVersion) {
          window.location.reload();
        }
        lastVersion = data.version;
      } catch (e) {}
    }
    setInterval(checkForUpdates, 2000);

    function toggleDark() {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('dark', document.documentElement.classList.contains('dark'));
    }
    if (localStorage.getItem('dark') === 'true') {
      document.documentElement.classList.add('dark');
    }
  </script>
</head>
<body class="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-4 transition-colors">

  <!-- Theme toggle -->
  <button onclick="toggleDark()" class="mb-4 px-3 py-1.5 text-xs rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
    Toggle light/dark
  </button>

  <!-- Tweet card -->
  <div class="w-full max-w-[598px] bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-2xl p-4">

    <!-- Header: avatar + name -->
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0">
        ${avatarHtml}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1">
          <span class="font-bold text-[15px] text-gray-900 dark:text-gray-100 truncate">${escapeHtml(tweet.displayName)}</span>
          ${verifiedHtml}
        </div>
        <div class="text-[15px] text-gray-500 dark:text-gray-500">@${escapeHtml(tweet.handle)}</div>
      </div>
      <!-- X logo -->
      <svg viewBox="0 0 24 24" class="w-6 h-6 fill-gray-900 dark:fill-white flex-shrink-0"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
    </div>

    <!-- Tweet text -->
    <div class="mt-3 text-[17px] leading-[24px] text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
      ${textHtml}
    </div>

    <!-- Image -->
    ${imageHtml}

    <!-- Timestamp -->
    <div class="mt-3 text-[13px] text-gray-500 dark:text-gray-500">
      ${escapeHtml(timestamp)}
    </div>

    <!-- Divider -->
    <div class="border-t border-gray-200 dark:border-gray-800 my-3"></div>

    <!-- Metrics -->
    <div class="flex items-center gap-6 text-[13px] text-gray-500 dark:text-gray-500">
      ${tweet.views !== undefined ? `<span><span class="font-bold text-gray-900 dark:text-gray-100">${formatNumber(tweet.views)}</span> Views</span>` : ""}
      ${tweet.retweets !== undefined ? `<span><span class="font-bold text-gray-900 dark:text-gray-100">${formatNumber(tweet.retweets)}</span> Reposts</span>` : ""}
      ${tweet.likes !== undefined ? `<span><span class="font-bold text-gray-900 dark:text-gray-100">${formatNumber(tweet.likes)}</span> Likes</span>` : ""}
    </div>

    <!-- Divider -->
    <div class="border-t border-gray-200 dark:border-gray-800 my-3"></div>

    <!-- Action buttons -->
    <div class="flex items-center justify-around text-gray-500 dark:text-gray-500">
      <!-- Reply -->
      <button class="flex items-center gap-2 hover:text-sky-500 transition-colors group p-2 rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20">
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.893 4.306-2.394 5.82l-5.72 5.77c-.185.186-.445.293-.707.293-.553 0-1-.447-1-1v-4.011c-3.249-.126-5.7-1.16-7.276-2.718C3.596 12.755 2.75 10.799 2.75 10h-1z"></path></svg>
        ${tweet.replies !== undefined ? `<span class="text-xs">${formatNumber(tweet.replies)}</span>` : ""}
      </button>
      <!-- Repost -->
      <button class="flex items-center gap-2 hover:text-green-500 transition-colors group p-2 rounded-full hover:bg-green-50 dark:hover:bg-green-900/20">
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></svg>
        ${tweet.retweets !== undefined ? `<span class="text-xs">${formatNumber(tweet.retweets)}</span>` : ""}
      </button>
      <!-- Like -->
      <button class="flex items-center gap-2 hover:text-pink-500 transition-colors group p-2 rounded-full hover:bg-pink-50 dark:hover:bg-pink-900/20">
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.965 3.036 4.175 6.127 6.36 3.09-2.185 5.053-4.395 6.127-6.36 1.112-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.907-1.91z"></path></svg>
        ${tweet.likes !== undefined ? `<span class="text-xs">${formatNumber(tweet.likes)}</span>` : ""}
      </button>
      <!-- Bookmark -->
      <button class="hover:text-sky-500 transition-colors p-2 rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20">
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"></path></svg>
      </button>
      <!-- Share -->
      <button class="hover:text-sky-500 transition-colors p-2 rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20">
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"></path></svg>
      </button>
    </div>
  </div>

  <!-- Character count indicator -->
  <div class="mt-4 flex items-center gap-3 text-sm ${isOverLimit ? "text-red-500" : "text-gray-500 dark:text-gray-400"}">
    <svg width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5" class="stroke-gray-200 dark:stroke-gray-700"></circle>
      <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5"
        stroke-dasharray="${2 * Math.PI * 14}"
        stroke-dashoffset="${2 * Math.PI * 14 * (1 - charPercent / 100)}"
        stroke-linecap="round"
        transform="rotate(-90 16 16)"
        class="${isOverLimit ? "stroke-red-500" : charPercent > 90 ? "stroke-yellow-500" : "stroke-sky-500"}">
      </circle>
    </svg>
    <span>${charCount} / ${charLimit}${isOverLimit ? " (over limit!)" : ""}</span>
  </div>

</body>
</html>`;
}

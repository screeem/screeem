import { App } from "@modelcontextprotocol/ext-apps";

interface TweetData {
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

interface LinkedInPostData {
  authorName: string;
  authorHeadline?: string;
  authorAvatarUrl?: string;
  text: string;
  imageUrl?: string;
  timestamp?: string;
  likes?: number;
  comments?: number;
  reposts?: number;
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

function tokenizeText(text: string, linkClass: string): string {
  const tokens: { placeholder: string; html: string }[] = [];
  let idx = 0;

  function tokenize(raw: string, pattern: RegExp, toHtml: (match: string, ...groups: string[]) => string): string {
    return raw.replace(pattern, (...args) => {
      const placeholder = `\x00TOK${idx++}\x00`;
      tokens.push({ placeholder, html: toHtml(...args) });
      return placeholder;
    });
  }

  let processed = text;
  processed = tokenize(processed, /(https?:\/\/[^\s]+)/g, (_, url) =>
    `<a href="${escapeHtml(url)}" class="${linkClass}">${escapeHtml(url)}</a>`
  );
  processed = tokenize(processed, /@(\w+)/g, (_, handle) =>
    `<a href="#" class="${linkClass}">@${escapeHtml(handle)}</a>`
  );
  processed = tokenize(processed, /#(\w+)/g, (_, tag) =>
    `<a href="#" class="${linkClass}">#${escapeHtml(tag)}</a>`
  );

  let html = escapeHtml(processed);
  for (const { placeholder, html: replacement } of tokens) {
    html = html.replace(placeholder, replacement);
  }
  html = html.replace(/\n/g, "<br>");
  return html;
}

// ── Tweet renderer ────────────────────────────────────────────────────────────

const TWEET_VERIFIED_SVG = `<svg viewBox="0 0 22 22" class="verified-badge"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.144.271.592.706 1.092 1.246 1.448s1.173.552 1.813.568c.646-.016 1.273-.211 1.813-.567s.972-.854 1.246-1.44c.608.222 1.267.272 1.902.14.635-.13 1.22-.436 1.69-.882.445-.47.749-1.055.878-1.69.13-.634.08-1.29-.144-1.897.587-.274 1.087-.705 1.443-1.245.356-.54.555-1.17.574-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path></svg>`;

const TWEET_DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:#6b7280"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>`;

const X_LOGO_SVG = `<svg viewBox="0 0 24 24" class="x-logo"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>`;

function renderTweet(tweet: Partial<TweetData> & { text: string }): string {
  const displayName = tweet.displayName ?? "";
  const handle = tweet.handle ?? "";
  const charCount = tweet.text.length;
  const charLimit = 280;
  const isOverLimit = charCount > charLimit;
  const charPercent = Math.min((charCount / charLimit) * 100, 100);
  const circumference = 2 * Math.PI * 14;

  const avatarHtml = tweet.avatarUrl
    ? `<img src="${escapeHtml(tweet.avatarUrl)}" alt="" />`
    : TWEET_DEFAULT_AVATAR_SVG;

  const verifiedHtml = tweet.verified ? TWEET_VERIFIED_SVG : "";

  const imageHtml = tweet.imageUrl
    ? `<div class="tweet-image"><img src="${escapeHtml(tweet.imageUrl)}" alt="" /></div>`
    : "";

  const timestamp = tweet.timestamp || new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }) + " \u00b7 " + new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const metricsItems: string[] = [];
  if (tweet.views !== undefined) metricsItems.push(`<span><span class="value">${formatNumber(tweet.views)}</span> Views</span>`);
  if (tweet.retweets !== undefined) metricsItems.push(`<span><span class="value">${formatNumber(tweet.retweets)}</span> Reposts</span>`);
  if (tweet.likes !== undefined) metricsItems.push(`<span><span class="value">${formatNumber(tweet.likes)}</span> Likes</span>`);

  const isDark = document.body.classList.contains("dark");

  return `
    <div class="tweet-card">
      <div class="tweet-header">
        <div class="avatar">${avatarHtml}</div>
        <div class="tweet-header-content">
          <div><span class="display-name">${escapeHtml(displayName)}</span>${verifiedHtml}</div>
          <div class="handle">@${escapeHtml(handle)}</div>
        </div>
        ${X_LOGO_SVG}
      </div>

      <div class="tweet-text">${tokenizeText(tweet.text, "tweet-link")}</div>

      ${imageHtml}

      <div class="timestamp">${escapeHtml(timestamp)}</div>

      ${metricsItems.length > 0 ? `<div class="divider"></div><div class="metrics">${metricsItems.join("")}</div>` : ""}

      <div class="divider"></div>

      <div class="actions">
        <button class="action-btn">
          <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.893 4.306-2.394 5.82l-5.72 5.77c-.185.186-.445.293-.707.293-.553 0-1-.447-1-1v-4.011c-3.249-.126-5.7-1.16-7.276-2.718C3.596 12.755 2.75 10.799 2.75 10h-1z"></path></svg>
          ${tweet.replies !== undefined ? `<span>${formatNumber(tweet.replies)}</span>` : ""}
        </button>
        <button class="action-btn">
          <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></svg>
          ${tweet.retweets !== undefined ? `<span>${formatNumber(tweet.retweets)}</span>` : ""}
        </button>
        <button class="action-btn">
          <svg viewBox="0 0 24 24"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.965 3.036 4.175 6.127 6.36 3.09-2.185 5.053-4.395 6.127-6.36 1.112-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.907-1.91z"></path></svg>
          ${tweet.likes !== undefined ? `<span>${formatNumber(tweet.likes)}</span>` : ""}
        </button>
        <button class="action-btn">
          <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"></path></svg>
        </button>
        <button class="action-btn">
          <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"></path></svg>
        </button>
      </div>
    </div>

    <div class="char-count${isOverLimit ? " over-limit" : ""}">
      <svg width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5" stroke="${isDark ? "#2f3336" : "#e1e8ed"}"></circle>
        <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference * (1 - charPercent / 100)}"
          stroke-linecap="round"
          transform="rotate(-90 16 16)"
          stroke="${isOverLimit ? "#f4212e" : charPercent > 90 ? "#ffd400" : "#1d9bf0"}">
        </circle>
      </svg>
      <span>${charCount} / ${charLimit}${isOverLimit ? " (over limit!)" : ""}</span>
    </div>
  `;
}

// ── LinkedIn renderer ─────────────────────────────────────────────────────────

const LI_DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:#b0b0b0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>`;

const GLOBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="li-globe-icon"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8A6.5 6.5 0 018 1.5c.47 0 .93.05 1.38.14L7.5 3.5H5L3.06 6.44A6.48 6.48 0 011.5 8zm1.06 2.5L4 8.5h2.5l1 3H5l-2.44-1zm5.94 4a6.5 6.5 0 01-3.44-1.5H6l1-2.5h3l.5 2-2 2zm2.94-1.56L13 11.5h-1.5L10 8.5H12l1.44 1.44c-.23.68-.55 1.33-.94 1.92l-.06.08zm1.56-4.94c0 .68-.1 1.34-.28 1.96L13 10H11L9.5 6.5H12l.94.94c.06.5.09 1 .09 1.5l-.03.5zM10 5.5H8.5l1-2.5c.52.25 1 .58 1.44.96L10 5.5z"/></svg>`;

function renderLinkedInPost(post: Partial<LinkedInPostData> & { text: string }): string {
  const authorName = post.authorName ?? "";
  const charCount = post.text.length;
  const charLimit = 3000;
  const isOverLimit = charCount > charLimit;
  const charPercent = Math.min((charCount / charLimit) * 100, 100);
  const circumference = 2 * Math.PI * 14;

  const avatarHtml = post.authorAvatarUrl
    ? `<img src="${escapeHtml(post.authorAvatarUrl)}" alt="" class="li-avatar-img" />`
    : LI_DEFAULT_AVATAR_SVG;

  const headlineHtml = post.authorHeadline
    ? `<div class="li-headline">${escapeHtml(post.authorHeadline)}</div>`
    : "";

  const timestamp = post.timestamp || "Just now";

  const imageHtml = post.imageUrl
    ? `<div class="li-image"><img src="${escapeHtml(post.imageUrl)}" alt="" /></div>`
    : "";

  const reactionParts: string[] = [];
  if (post.likes !== undefined) {
    reactionParts.push(`<span class="li-reaction-left"><span class="li-reaction-emoji">👍</span> <span class="li-reaction-count">${formatNumber(post.likes)}</span></span>`);
  }
  const secondaryParts: string[] = [];
  if (post.comments !== undefined) secondaryParts.push(`${formatNumber(post.comments)} comments`);
  if (post.reposts !== undefined) secondaryParts.push(`${formatNumber(post.reposts)} reposts`);

  const reactionsHtml = (reactionParts.length > 0 || secondaryParts.length > 0)
    ? `<div class="li-reactions">
        <div>${reactionParts.join("")}</div>
        <div class="li-reactions-secondary">${secondaryParts.join(" · ")}</div>
      </div>`
    : "";

  return `
    <div class="li-card">
      <div class="li-header">
        <div class="li-avatar">${avatarHtml}</div>
        <div class="li-author-info">
          <div class="li-author-name">${escapeHtml(authorName)}</div>
          ${headlineHtml}
          <div class="li-post-meta">
            <span>${escapeHtml(timestamp)}</span>
            <span class="li-dot">·</span>
            ${GLOBE_SVG}
          </div>
        </div>
        <button class="li-follow-btn">Follow</button>
      </div>

      <div class="li-text">${tokenizeText(post.text, "li-link")}</div>

      ${imageHtml}

      ${reactionsHtml}

      ${reactionsHtml ? '<div class="li-divider"></div>' : ""}

      <div class="li-actions">
        <button class="li-action-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.46 11l-3.91-3.91a7 7 0 01-1.69-2.74l-.49-1.47A2.76 2.76 0 0010.76 1 2.75 2.75 0 008 3.74v1.12a9.19 9.19 0 00.46 2.85L9 9H4.5A2.5 2.5 0 002 11.5a2.6 2.6 0 00.2 1A2.49 2.49 0 002 14a2.65 2.65 0 00.47 1.5 2.5 2.5 0 00.23 3A2.5 2.5 0 005 21h8a7 7 0 006.16-3.71l1.3-2.77A2 2 0 0022 13.4v-1.4a1 1 0 00-1-1zM20 13.4a.17.17 0 010 .06l-1.3 2.77A5 5 0 0113 19H5a.5.5 0 01-.45-.72.49.49 0 00-.05-.42A.49.49 0 004.5 17a.5.5 0 01-.5-.5.52.52 0 01.09-.28.5.5 0 00-.09-.7A.5.5 0 013.5 15a.5.5 0 01-.28-.09.5.5 0 01-.22-.41.52.52 0 01.5-.5H13a1 1 0 001-1 1 1 0 00-.07-.36L13 11H9a7.23 7.23 0 01-.36-2.26V3.74a.75.75 0 01.75-.74.76.76 0 01.74.56l.49 1.47a9 9 0 002.17 3.52L16.7 12H19a1 1 0 011 1z"/></svg>
          Like
        </button>
        <button class="li-action-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 9h10v1H7zm0 4h7v-1H7zm16-2a6.78 6.78 0 01-2.84 5.61L12 22v-4H8A7 7 0 018 4h8a7 7 0 017 7zm-2 0a5 5 0 00-5-5H8a5 5 0 000 10h6v2.28L17.07 15A4.75 4.75 0 0019 11z"/></svg>
          Comment
        </button>
        <button class="li-action-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13.96 5H6a5 5 0 000 10h7v2H6A7 7 0 016 3h7.96zM10 19h8a5 5 0 000-10h-7V7h7a7 7 0 010 14h-8z"/></svg>
          Repost
        </button>
        <button class="li-action-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 3L0 10l7.66 4.26L16 8l-6.26 8.34L14 24l7-21z"/></svg>
          Send
        </button>
      </div>
    </div>

    <div class="char-count${isOverLimit ? " over-limit" : ""}">
      <svg width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5" stroke="#e0dfe2"></circle>
        <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference * (1 - charPercent / 100)}"
          stroke-linecap="round"
          transform="rotate(-90 16 16)"
          stroke="${isOverLimit ? "#cc1016" : charPercent > 90 ? "#f5c400" : "#0a66c2"}">
        </circle>
      </svg>
      <span>${charCount} / ${charLimit}${isOverLimit ? " (over limit!)" : ""}</span>
    </div>
  `;
}

// ── App setup ─────────────────────────────────────────────────────────────────

const app = new App({ name: "Post Preview", version: "0.0.1" });
const root = document.getElementById("root")!;

function applyTheme(theme: "light" | "dark" | undefined) {
  if (theme === "dark") {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
}

app.ontoolresult = (params) => {
  const text = params.content?.find((c: { type: string }) => c.type === "text") as { type: string; text: string } | undefined;
  if (!text?.text) return;

  try {
    const data = JSON.parse(text.text);
    if (data._type === "linkedin") {
      root.innerHTML = renderLinkedInPost(data as LinkedInPostData);
    } else {
      root.innerHTML = renderTweet(data as TweetData);
    }
  } catch {
    root.textContent = text.text;
  }
};

app.onhostcontextchanged = (params) => {
  if (params.theme) {
    applyTheme(params.theme as "light" | "dark");
  }
};

await app.connect();

const ctx = app.getHostContext();
if (ctx?.theme) applyTheme(ctx.theme);

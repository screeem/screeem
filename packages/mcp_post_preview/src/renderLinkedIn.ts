export interface LinkedInPostData {
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

function renderPostText(text: string): string {
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
    `<a href="${escapeHtml(url)}" style="color:#0a66c2;text-decoration:none;">${escapeHtml(url)}</a>`
  );
  processed = tokenize(processed, /@(\w+)/g, (_, handle) =>
    `<a href="#" style="color:#0a66c2;text-decoration:none;font-weight:600;">@${escapeHtml(handle)}</a>`
  );
  processed = tokenize(processed, /#(\w+)/g, (_, tag) =>
    `<a href="#" style="color:#0a66c2;text-decoration:none;font-weight:600;">#${escapeHtml(tag)}</a>`
  );

  let html = escapeHtml(processed);
  for (const { placeholder, html: replacement } of tokens) {
    html = html.replace(placeholder, replacement);
  }
  html = html.replace(/\n/g, "<br>");
  return html;
}

const DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:#b0b0b0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>`;

const GLOBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" style="width:12px;height:12px;fill:rgba(0,0,0,0.6);vertical-align:middle;"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8A6.5 6.5 0 018 1.5c.47 0 .93.05 1.38.14L7.5 3.5H5L3.06 6.44A6.48 6.48 0 011.5 8zm1.06 2.5L4 8.5h2.5l1 3H5l-2.44-1zm5.94 4a6.5 6.5 0 01-3.44-1.5H6l1-2.5h3l.5 2-2 2zm2.94-1.56L13 11.5h-1.5L10 8.5H12l1.44 1.44c-.23.68-.55 1.33-.94 1.92l-.06.08zm1.56-4.94c0 .68-.1 1.34-.28 1.96L13 10H11L9.5 6.5H12l.94.94c.06.5.09 1 .09 1.5l-.03.5zM10 5.5H8.5l1-2.5c.52.25 1 .58 1.44.96L10 5.5z"/></svg>`;

export function renderLinkedInHtml(post: LinkedInPostData): string {
  const charCount = post.text.length;
  const charLimit = 3000;
  const isOverLimit = charCount > charLimit;
  const charPercent = Math.min((charCount / charLimit) * 100, 100);

  const avatarHtml = post.authorAvatarUrl
    ? `<img src="${escapeHtml(post.authorAvatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : DEFAULT_AVATAR_SVG;

  const headlineHtml = post.authorHeadline
    ? `<div style="font-size:13px;color:rgba(0,0,0,0.6);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px;">${escapeHtml(post.authorHeadline)}</div>`
    : "";

  const timestamp = post.timestamp || "Just now";
  const imageHtml = post.imageUrl
    ? `<div style="margin-top:8px;overflow:hidden;"><img src="${escapeHtml(post.imageUrl)}" alt="" style="width:100%;display:block;max-height:512px;object-fit:cover;" /></div>`
    : "";

  const reactionsHtml = (() => {
    const parts: string[] = [];
    if (post.likes !== undefined) {
      parts.push(`<span style="display:inline-flex;align-items:center;gap:3px;"><span style="font-size:14px;">👍</span> <span style="color:rgba(0,0,0,0.6);font-size:13px;">${formatNumber(post.likes)}</span></span>`);
    }
    const secondary: string[] = [];
    if (post.comments !== undefined) secondary.push(`${formatNumber(post.comments)} comments`);
    if (post.reposts !== undefined) secondary.push(`${formatNumber(post.reposts)} reposts`);

    if (parts.length === 0 && secondary.length === 0) return "";

    return `
    <div style="padding:6px 16px;display:flex;justify-content:space-between;align-items:center;color:rgba(0,0,0,0.6);font-size:13px;">
      <div>${parts.join("")}</div>
      <div>${secondary.join(" · ")}</div>
    </div>`;
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LinkedIn Post Preview — ${escapeHtml(post.authorName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f3f2ef;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    a { color: #0a66c2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card {
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e0dfe2;
      max-width: 555px;
      width: 100%;
      overflow: hidden;
    }
    .toggle-btn {
      margin-bottom: 12px;
      padding: 6px 14px;
      font-size: 12px;
      border-radius: 20px;
      border: 1px solid #e0dfe2;
      background: #fff;
      cursor: pointer;
      color: rgba(0,0,0,0.6);
    }
    .char-count {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: rgba(0,0,0,0.5);
    }
    .char-count.over-limit { color: #cc1016; }
  </style>
  <script>
    function toggleDark() {
      document.body.style.background = document.body.style.background === 'rgb(28, 28, 28)' ? '#f3f2ef' : '#1c1c1c';
    }
  </script>
</head>
<body>
  <button class="toggle-btn" onclick="toggleDark()">Toggle light/dark</button>

  <div class="card">
    <!-- Header -->
    <div style="padding:12px 16px;display:flex;align-items:flex-start;gap:8px;">
      <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#e0dfe2;display:flex;align-items:center;justify-content:center;">
        ${avatarHtml}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;color:rgba(0,0,0,0.9);line-height:1.4;">${escapeHtml(post.authorName)}</div>
        ${headlineHtml}
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:2px;display:flex;align-items:center;gap:4px;">
          <span>${escapeHtml(timestamp)}</span>
          <span>·</span>
          ${GLOBE_SVG}
        </div>
      </div>
      <button style="background:#e8f0fe;color:#0a66c2;border:1px solid #0a66c2;padding:5px 14px;border-radius:20px;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0;">Follow</button>
    </div>

    <!-- Post text -->
    <div style="padding:0 16px 8px;font-size:14px;line-height:1.5;color:rgba(0,0,0,0.9);word-wrap:break-word;white-space:pre-wrap;">
      ${renderPostText(post.text)}
    </div>

    <!-- Image -->
    ${imageHtml}

    <!-- Reactions -->
    ${reactionsHtml}

    ${reactionsHtml ? '<div style="border-top:1px solid #e0dfe2;margin:0 16px;"></div>' : ""}

    <!-- Action buttons -->
    <div style="display:flex;padding:2px 8px 4px;">
      <button style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border:none;background:none;color:rgba(0,0,0,0.6);font-size:14px;font-weight:600;cursor:pointer;border-radius:4px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M19.46 11l-3.91-3.91a7 7 0 01-1.69-2.74l-.49-1.47A2.76 2.76 0 0010.76 1 2.75 2.75 0 008 3.74v1.12a9.19 9.19 0 00.46 2.85L9 9H4.5A2.5 2.5 0 002 11.5a2.6 2.6 0 00.2 1A2.49 2.49 0 002 14a2.65 2.65 0 00.47 1.5 2.5 2.5 0 00.23 3A2.5 2.5 0 005 21h8a7 7 0 006.16-3.71l1.3-2.77A2 2 0 0022 13.4v-1.4a1 1 0 00-1-1zM20 13.4a.17.17 0 010 .06l-1.3 2.77A5 5 0 0113 19H5a.5.5 0 01-.45-.72.49.49 0 00-.05-.42A.49.49 0 004.5 17a.5.5 0 01-.5-.5.52.52 0 01.09-.28.5.5 0 00-.09-.7A.5.5 0 013.5 15a.5.5 0 01-.28-.09.5.5 0 01-.22-.41.52.52 0 01.5-.5H13a1 1 0 001-1 1 1 0 00-.07-.36L13 11H9a7.23 7.23 0 01-.36-2.26V3.74a.75.75 0 01.75-.74.76.76 0 01.74.56l.49 1.47a9 9 0 002.17 3.52L16.7 12H19a1 1 0 011 1z"/></svg>
        Like
      </button>
      <button style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border:none;background:none;color:rgba(0,0,0,0.6);font-size:14px;font-weight:600;cursor:pointer;border-radius:4px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M7 9h10v1H7zm0 4h7v-1H7zm16-2a6.78 6.78 0 01-2.84 5.61L12 22v-4H8A7 7 0 018 4h8a7 7 0 017 7zm-2 0a5 5 0 00-5-5H8a5 5 0 000 10h6v2.28L17.07 15A4.75 4.75 0 0019 11z"/></svg>
        Comment
      </button>
      <button style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border:none;background:none;color:rgba(0,0,0,0.6);font-size:14px;font-weight:600;cursor:pointer;border-radius:4px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M13.96 5H6a5 5 0 000 10h7v2H6A7 7 0 016 3h7.96zM10 19h8a5 5 0 000-10h-7V7h7a7 7 0 010 14h-8z"/></svg>
        Repost
      </button>
      <button style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border:none;background:none;color:rgba(0,0,0,0.6);font-size:14px;font-weight:600;cursor:pointer;border-radius:4px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M21 3L0 10l7.66 4.26L16 8l-6.26 8.34L14 24l7-21z"/></svg>
        Send
      </button>
    </div>
  </div>

  <!-- Character count indicator -->
  <div style="margin-top:12px;display:flex;align-items:center;gap:10px;font-size:13px;color:${isOverLimit ? "#cc1016" : "rgba(0,0,0,0.5)"};">
    <svg width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5" stroke="#e0dfe2"></circle>
      <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5"
        stroke-dasharray="${2 * Math.PI * 14}"
        stroke-dashoffset="${2 * Math.PI * 14 * (1 - charPercent / 100)}"
        stroke-linecap="round"
        transform="rotate(-90 16 16)"
        stroke="${isOverLimit ? "#cc1016" : charPercent > 90 ? "#f5c400" : "#0a66c2"}">
      </circle>
    </svg>
    <span>${charCount} / ${charLimit}${isOverLimit ? " (over limit!)" : ""}</span>
  </div>

</body>
</html>`;
}

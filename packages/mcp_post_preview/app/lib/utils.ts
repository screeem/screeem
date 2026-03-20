export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

export function tokenizeText(text: string, linkClass: string): string {
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

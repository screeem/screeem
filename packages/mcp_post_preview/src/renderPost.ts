export interface PostData {
  title: string;
  content: string;
  author: string;
  date: string;
  tags?: string[];
  slug?: string;
  excerpt?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Converts basic markdown to HTML.
 * Supports headings, bold, italic, links, code blocks, inline code, lists, and blockquotes.
 */
function markdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto my-4"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-xl font-semibold text-gray-900 mt-6 mb-3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-2xl font-semibold text-gray-900 mt-8 mb-4">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-3xl font-bold text-gray-900 mt-8 mb-4">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:text-blue-800 underline">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="rounded-lg my-4 max-w-full" />');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-4 border-gray-300 pl-4 italic text-gray-600 my-4">$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc text-gray-700">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul class="my-4 space-y-1">${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-700">$1</li>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-8 border-gray-200" />');

  // Paragraphs: wrap remaining lines that aren't already in block elements
  const lines = html.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<ul") ||
      trimmed.startsWith("<ol") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("<img") ||
      trimmed.startsWith("</")
    ) {
      result.push(line);
    } else {
      result.push(`<p class="text-gray-700 leading-relaxed mb-4">${line}</p>`);
    }
  }

  return result.join("\n");
}

/**
 * Renders a blog post as a full standalone HTML page
 * using the same Tailwind CSS styling as the @screeem/blog components.
 */
export function renderPostHtml(post: PostData): string {
  const tagsHtml =
    post.tags && post.tags.length > 0
      ? `<div class="flex flex-wrap gap-2">
          ${post.tags
            .map(
              (tag) =>
                `<span class="px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">${escapeHtml(tag)}</span>`
            )
            .join("\n          ")}
        </div>`
      : "";

  const contentHtml = markdownToHtml(post.content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(post.title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Auto-refresh: the MCP server will trigger a reload when the post is updated */
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  </style>
  <script>
    // Poll for updates every 2 seconds
    let lastVersion = 0;
    async function checkForUpdates() {
      try {
        const res = await fetch('/api/version');
        const data = await res.json();
        if (lastVersion > 0 && data.version !== lastVersion) {
          window.location.reload();
        }
        lastVersion = data.version;
      } catch (e) {
        // Server might not be ready yet
      }
    }
    setInterval(checkForUpdates, 2000);
  </script>
</head>
<body class="min-h-screen bg-gray-50 py-12">
  <div class="container mx-auto px-4">
    <article class="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <header class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">${escapeHtml(post.title)}</h1>
        <div class="flex items-center text-gray-600 text-sm mb-4">
          <span>By ${escapeHtml(post.author)}</span>
          <span class="mx-2">&bull;</span>
          <time>${escapeHtml(post.date)}</time>
        </div>
        ${tagsHtml}
      </header>
      <div class="prose prose-lg max-w-none">
        ${contentHtml}
      </div>
    </article>
  </div>
</body>
</html>`;
}

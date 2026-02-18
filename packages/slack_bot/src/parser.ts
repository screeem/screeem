export interface ParsedLink {
  platform: string;
  url: string;
  author: string;
}

interface PlatformPattern {
  platform: string;
  pattern: RegExp;
  extractAuthor: (match: RegExpMatchArray) => string;
}

const PLATFORM_PATTERNS: PlatformPattern[] = [
  {
    platform: "twitter",
    pattern: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/\d+/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "linkedin",
    pattern: /https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|feed\/update|pulse)\/([a-zA-Z0-9_-]+)/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "instagram",
    pattern: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/g,
    extractAuthor: (match) => "",
  },
  {
    platform: "instagram",
    pattern: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)\/(?:p|reel)\/([a-zA-Z0-9_-]+)/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "facebook",
    pattern: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9.]+)\/posts\/\d+/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "facebook",
    pattern: /https?:\/\/(?:www\.)?facebook\.com\/share\/[a-zA-Z0-9_-]+/g,
    extractAuthor: () => "",
  },
  {
    platform: "youtube",
    pattern: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g,
    extractAuthor: () => "",
  },
  {
    platform: "tiktok",
    pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+)\/video\/\d+/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "threads",
    pattern: /https?:\/\/(?:www\.)?threads\.net\/@?([a-zA-Z0-9_.]+)\/post\/[a-zA-Z0-9_-]+/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "bluesky",
    pattern: /https?:\/\/bsky\.app\/profile\/([a-zA-Z0-9._-]+)\/post\/[a-zA-Z0-9]+/g,
    extractAuthor: (match) => match[1],
  },
  {
    platform: "mastodon",
    pattern: /https?:\/\/([a-zA-Z0-9.-]+)\/@([a-zA-Z0-9_]+)\/\d+/g,
    extractAuthor: (match) => `${match[2]}@${match[1]}`,
  },
  {
    platform: "reddit",
    pattern: /https?:\/\/(?:www\.)?reddit\.com\/r\/([a-zA-Z0-9_]+)\/comments\/[a-zA-Z0-9_]+/g,
    extractAuthor: (match) => `r/${match[1]}`,
  },
];

export function parseLinks(text: string): ParsedLink[] {
  const results: ParsedLink[] = [];
  const seenUrls = new Set<string>();

  // Slack wraps URLs in angle brackets: <https://example.com>
  // or with labels: <https://example.com|example.com>
  const unwrapped = text.replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, "$1");

  for (const { platform, pattern, extractAuthor } of PLATFORM_PATTERNS) {
    // Reset regex lastIndex since we reuse them
    pattern.lastIndex = 0;
    let match: RegExpMatchArray | null;

    while ((match = pattern.exec(unwrapped)) !== null) {
      const url = match[0];
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        results.push({
          platform,
          url,
          author: extractAuthor(match),
        });
      }
    }
  }

  return results;
}

export function containsSocialMediaLinks(text: string): boolean {
  return parseLinks(text).length > 0;
}

export function stripUrls(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}

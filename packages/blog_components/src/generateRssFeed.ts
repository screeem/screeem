import { Feed } from 'feed';
import type { BlogPost } from './types';

export interface RssFeedConfig {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl?: string;
  language?: string;
  copyright?: string;
  author?: {
    name: string;
    email?: string;
    link?: string;
  };
  imageUrl?: string;
}

export function generateRssFeed(
  posts: BlogPost[],
  config: RssFeedConfig
): { rss: string; atom: string; json: string } {
  const {
    title,
    description,
    siteUrl,
    feedUrl,
    language = 'en',
    copyright,
    author,
    imageUrl,
  } = config;

  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const feed = new Feed({
    title,
    description,
    id: siteUrl,
    link: siteUrl,
    language,
    image: imageUrl,
    favicon: imageUrl ? `${siteUrl}/favicon.ico` : undefined,
    copyright: copyright ?? `All rights reserved ${new Date().getFullYear()}`,
    feedLinks: feedUrl ? {
      rss2: feedUrl,
      atom: feedUrl.replace(/\.xml$/, '.atom'),
      json: feedUrl.replace(/\.xml$/, '.json'),
    } : undefined,
    author,
  });

  for (const post of sortedPosts) {
    const postUrl = `${siteUrl}/${post.slug || post.id}`;

    feed.addItem({
      title: post.title,
      id: postUrl,
      link: postUrl,
      description: post.excerpt || post.content.slice(0, 200) + '...',
      content: post.content,
      author: [{ name: post.author }],
      date: new Date(post.date),
      category: post.tags?.map((tag) => ({ name: tag })),
    });
  }

  return {
    rss: feed.rss2(),
    atom: feed.atom1(),
    json: feed.json1(),
  };
}

export function createRssFeedResponse(
  posts: BlogPost[],
  config: RssFeedConfig,
  format: 'rss' | 'atom' | 'json' = 'rss'
): Response {
  const feeds = generateRssFeed(posts, config);

  const contentTypes = {
    rss: 'application/rss+xml; charset=utf-8',
    atom: 'application/atom+xml; charset=utf-8',
    json: 'application/feed+json; charset=utf-8',
  };

  return new Response(feeds[format], {
    headers: {
      'Content-Type': contentTypes[format],
    },
  });
}

export function createRssFeedRoute(
  posts: BlogPost[] | (() => BlogPost[] | Promise<BlogPost[]>),
  config: RssFeedConfig,
  format: 'rss' | 'atom' | 'json' = 'rss'
) {
  return async function GET() {
    const resolvedPosts = typeof posts === 'function' ? await posts() : posts;
    return createRssFeedResponse(resolvedPosts, config, format);
  };
}

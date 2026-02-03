import { createRssFeedRoute } from '@screeem/blog';

const posts = [
  {
    id: 'welcome-to-my-blog',
    slug: 'blog',
    title: 'Welcome to My Blog',
    content: 'This is a sample blog post demonstrating the BlogPost component.',
    author: 'John Doe',
    date: '2025-01-08',
    tags: ['React', 'Next.js'],
  },
];

export const GET = createRssFeedRoute(posts, {
  title: 'Sample Blog',
  description: 'A sample blog built with Next.js',
  siteUrl: 'https://example.com',
});

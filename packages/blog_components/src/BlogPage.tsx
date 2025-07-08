import React from 'react';
import { BlogPost as BlogPostType } from './types';
import { BlogPost } from './BlogPost';

interface BlogPageProps {
  posts: BlogPostType[];
  title?: string;
  description?: string;
}

export const BlogPage: React.FC<BlogPageProps> = ({
  posts,
  title = "Blog",
  description = "Latest blog posts"
}) => {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{title}</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{description}</p>
        </header>
        
        <div className="space-y-8">
          {posts.length > 0 ? (
            posts.map((post) => (
              <BlogPost
                key={post.id}
                title={post.title}
                content={post.content}
                author={post.author}
                date={post.date}
                tags={post.tags}
              />
            ))
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No blog posts available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
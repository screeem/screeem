import React from 'react';
import { BlogPost as BlogPostType } from './types';

interface BlogPostProps extends Omit<BlogPostType, 'id'> {}

export const BlogPost: React.FC<BlogPostProps> = ({
  title,
  content,
  author,
  date,
  tags = []
}) => {
  return (
    <article className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
        <div className="flex items-center text-gray-600 text-sm mb-4">
          <span>By {author}</span>
          <span className="mx-2">•</span>
          <time>{date}</time>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      <div className="prose prose-lg max-w-none">
        <p className="text-gray-700 leading-relaxed">{content}</p>
      </div>
    </article>
  );
};
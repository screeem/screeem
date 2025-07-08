import React from 'react';
interface BlogPostProps {
    title: string;
    content: string;
    author: string;
    date: string;
    tags?: string[];
}
export declare const BlogPost: React.FC<BlogPostProps>;
export {};

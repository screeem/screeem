import { BlogPost } from '@screeem/blog';

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4">
        <BlogPost
          title="Welcome to My Blog"
          content="This is a sample blog post demonstrating the BlogPost component from our shared blog_components package. The component is fully styled with Tailwind CSS and provides a clean, readable layout for blog content."
          author="John Doe"
          date="January 8, 2025"
          tags={["React", "Next.js", "TypeScript", "Tailwind CSS"]}
        />
      </div>
    </div>
  );
}
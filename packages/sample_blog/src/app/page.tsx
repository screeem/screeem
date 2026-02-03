import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <main className="text-center">
        <h1 className="text-4xl font-bold mb-4">Sample Blog</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          A sample blog built with Next.js and @screeem/blog
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/blog"
            className="px-6 py-3 bg-foreground text-background rounded-full font-medium hover:opacity-90"
          >
            View Blog
          </Link>
          <Link
            href="/feed.xml"
            className="px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-full font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            RSS Feed
          </Link>
        </div>
      </main>
    </div>
  );
}

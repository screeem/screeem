import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <header className="border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">Screeem</span>
          <nav className="flex items-center gap-6">
            <a
              href="https://github.com/screeem/screeem"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              GitHub
            </a>
            {user ? (
              <Link
                href="/dashboard"
                className="text-sm font-medium px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/auth/login"
                className="text-sm font-medium px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-600 mb-8">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          Open source · Self-hostable
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Product marketing,
          <br />
          <span className="text-gray-400">built for builders.</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          Screeem is the open-source marketing platform for dev teams. Create,
          preview, and publish social content — with the same workflow you use
          for code.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href={user ? "/dashboard" : "/auth/signup"}
            className="px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors w-full sm:w-auto text-center"
          >
            Get started for free
          </Link>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors w-full sm:w-auto text-center"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Social preview mockup */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Twitter card mockup */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div>
                  <div className="h-3 w-24 bg-gray-200 rounded mb-1" />
                  <div className="h-2.5 w-16 bg-gray-100 rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2.5 bg-gray-100 rounded w-full" />
                <div className="h-2.5 bg-gray-100 rounded w-4/5" />
                <div className="h-2.5 bg-gray-100 rounded w-3/5" />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="h-2 w-8 bg-gray-100 rounded" />
                <div className="h-2 w-8 bg-gray-100 rounded" />
                <div className="h-2 w-8 bg-gray-100 rounded" />
              </div>
              <p className="text-xs text-gray-400 mt-3 font-medium">Twitter / X preview</p>
            </div>
            {/* LinkedIn card mockup */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-blue-100" />
                <div>
                  <div className="h-3 w-28 bg-gray-200 rounded mb-1" />
                  <div className="h-2.5 w-20 bg-gray-100 rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2.5 bg-gray-100 rounded w-full" />
                <div className="h-2.5 bg-gray-100 rounded w-5/6" />
                <div className="h-2.5 bg-gray-100 rounded w-2/3" />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="h-2 w-10 bg-gray-100 rounded" />
                <div className="h-2 w-10 bg-gray-100 rounded" />
              </div>
              <p className="text-xs text-gray-400 mt-3 font-medium">LinkedIn preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">
            Everything you need to market your product
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto">
            Like PostHog, but for marketing. All the tools in one place, open
            source and built to extend.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: "✦",
              title: "Social post previews",
              desc: "See exactly how your posts will look on Twitter/X and LinkedIn before you publish.",
            },
            {
              icon: "⌘",
              title: "MCP server",
              desc: "Create and update posts directly from your AI assistant via the Model Context Protocol.",
            },
            {
              icon: "◈",
              title: "Multi-platform",
              desc: "Manage Twitter/X and LinkedIn from a single dashboard. More platforms coming.",
            },
            {
              icon: "◎",
              title: "Open source",
              desc: "Self-host on your own infra, audit the code, and extend it however you need.",
            },
            {
              icon: "⬡",
              title: "Developer-first",
              desc: "Built with Next.js, Supabase, and TypeScript. Feels familiar from day one.",
            },
            {
              icon: "◇",
              title: "More coming",
              desc: "Analytics, scheduling, A/B testing, changelog tooling — the roadmap is public.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <span className="text-xl mb-3 block text-gray-400">{f.icon}</span>
              <h3 className="font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 border-y border-gray-100 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              How it works
            </h2>
            <p className="text-gray-500">Get from idea to published in minutes.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Connect your profiles",
                desc: "Link your Twitter/X and LinkedIn accounts in the dashboard.",
              },
              {
                step: "02",
                title: "Write and preview",
                desc: "Draft your post and see a pixel-perfect preview for each platform.",
              },
              {
                step: "03",
                title: "Publish",
                desc: "Publish directly or queue it up. Use the MCP server to create posts from your AI workflow.",
              },
            ].map((s) => (
              <div key={s.step} className="flex flex-col">
                <span className="text-4xl font-bold text-gray-100 mb-3">
                  {s.step}
                </span>
                <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open source CTA */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Open source and built to last
        </h2>
        <p className="text-gray-500 max-w-xl mx-auto mb-8 leading-relaxed">
          Screeem is fully open source. Host it yourself, contribute features, or
          just use the cloud version. No lock-in, ever.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href={user ? "/dashboard" : "/auth/signup"}
            className="px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Start for free
          </Link>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Star on GitHub
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span className="font-semibold text-gray-900">Screeem</span>
          <span>Open-source product marketing platform.</span>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-900 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

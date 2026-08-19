import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border sticky top-0 bg-background/90 backdrop-blur-sm z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">Screeem</span>
          <nav className="flex items-center gap-6">
            <a
              href="https://github.com/screeem/screeem"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            {user ? (
              <Link
                href="/dashboard"
                className="text-sm font-medium px-4 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/auth/login"
                className="text-sm font-medium px-4 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted rounded-full text-xs font-medium text-muted-foreground mb-8">
          <span className="w-1.5 h-1.5 bg-success rounded-full" />
          Open source · Self-hostable
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Product marketing,
          <br />
          <span className="text-muted-foreground">built for builders.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Screeem is the open-source marketing platform for dev teams. Create,
          preview, and publish social content — with the same workflow you use
          for code.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href={user ? "/dashboard" : "/auth/signup"}
            className="px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors w-full sm:w-auto text-center"
          >
            Get started for free
          </Link>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors w-full sm:w-auto text-center"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Social preview mockup */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <div className="bg-muted rounded-2xl border border-border p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-3 h-3 rounded-full bg-error" />
            <div className="w-3 h-3 rounded-full bg-warning" />
            <div className="w-3 h-3 rounded-full bg-success" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Twitter card mockup */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div>
                  <div className="h-3 w-24 bg-muted rounded mb-1" />
                  <div className="h-2.5 w-16 bg-muted rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2.5 bg-muted rounded w-full" />
                <div className="h-2.5 bg-muted rounded w-4/5" />
                <div className="h-2.5 bg-muted rounded w-3/5" />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="h-2 w-8 bg-muted rounded" />
                <div className="h-2 w-8 bg-muted rounded" />
                <div className="h-2 w-8 bg-muted rounded" />
              </div>
              <p className="text-xs text-muted-foreground mt-3 font-medium">Twitter / X preview</p>
            </div>
            {/* LinkedIn card mockup */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-info-subtle" />
                <div>
                  <div className="h-3 w-28 bg-muted rounded mb-1" />
                  <div className="h-2.5 w-20 bg-muted rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2.5 bg-muted rounded w-full" />
                <div className="h-2.5 bg-muted rounded w-5/6" />
                <div className="h-2.5 bg-muted rounded w-2/3" />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="h-2 w-10 bg-muted rounded" />
                <div className="h-2 w-10 bg-muted rounded" />
              </div>
              <p className="text-xs text-muted-foreground mt-3 font-medium">LinkedIn preview</p>
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
          <p className="text-muted-foreground max-w-xl mx-auto">
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
              className="p-6 rounded-xl border border-border hover:border-border-strong hover:shadow-sm transition-all"
            >
              <span className="text-xl mb-3 block text-muted-foreground">{f.icon}</span>
              <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted border-y border-border py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              How it works
            </h2>
            <p className="text-muted-foreground">Get from idea to published in minutes.</p>
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
                <span className="text-4xl font-bold text-muted-foreground mb-3">
                  {s.step}
                </span>
                <h3 className="font-semibold text-foreground mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
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
        <p className="text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
          Screeem is fully open source. Host it yourself, contribute features, or
          just use the cloud version. No lock-in, ever.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href={user ? "/dashboard" : "/auth/signup"}
            className="px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
          >
            Start for free
          </Link>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors"
          >
            Star on GitHub
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Screeem</span>
          <span>Open-source product marketing platform.</span>
          <a
            href="https://github.com/screeem/screeem"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

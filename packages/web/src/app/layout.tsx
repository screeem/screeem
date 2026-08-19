import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/lib/providers";
import { themeStorageKey } from "@/components/ui/theme-toggle";
import "./globals.css";

// Self-hosted rather than next/font/google: a production `next build` fetches
// Google-hosted families over the network with no offline fallback, and the
// Docker build starts from an empty cache every run. The repo promises
// disconnected work after `make setup`, so the files are committed instead.
const inter = localFont({
  src: "./fonts/Inter-Variable-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable-latin.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

// Applies the stored choice before first paint, so a dark-mode user never sees
// a light flash. Deliberately ignores prefers-color-scheme: dark is an explicit
// decision here, not an inherited one.
const themeScript = `try{if(localStorage.getItem(${JSON.stringify(themeStorageKey)})==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: "Screeem",
  description: "Screeem web app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

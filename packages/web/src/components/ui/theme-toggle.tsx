"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export const themeStorageKey = "screeem-theme"

/** The `.dark` class on <html> is the source of truth, so it is subscribed to
 *  rather than mirrored into component state. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

/**
 * Dark mode is an explicit choice rather than a system preference, so the only
 * thing that sets `.dark` is a stored decision. The matching pre-paint script
 * lives in the root layout.
 */
export function ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  )

  function toggle() {
    const next = !isDark
    document.documentElement.classList.toggle("dark", next)
    try {
      window.localStorage.setItem(themeStorageKey, next ? "dark" : "light")
    } catch {
      // Private browsing can refuse storage; the class still applies for this page.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  )
}

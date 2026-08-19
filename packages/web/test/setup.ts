import { vi } from "vitest"

// Radix-backed primitives (dialog, select, dropdown-menu, tooltip) measure and
// observe layout on mount. jsdom implements none of these, so without the
// polyfills the first test to render one fails with `ResizeObserver is not
// defined` and reads as a component bug rather than missing test setup.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!Element.prototype[method]) {
      Element.prototype[method] = (() => false) as never
    }
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (() => {}) as never
  }
}

import { describe, expect, it } from "vitest"

import {
  canonicalObjectKey,
  canonicalObjectPrefix,
  InvalidObjectKeyError,
  objectKey,
  objectKeysEqual,
  parseCanonicalObjectKey,
} from "../src/index.js"

describe("object keys", () => {
  it("renders a tenant scoped canonical path", () => {
    const canonical = canonicalObjectKey({
      teamId: "8f14e45f",
      scope: "post-media",
      path: ["2026", "cover.png"],
    })

    expect(canonical).toBe("teams/8f14e45f/post-media/2026/cover.png")
  })

  it("terminates listing prefixes so neighbouring scopes cannot match", () => {
    expect(canonicalObjectPrefix({ teamId: "team", scope: "media" })).toBe("teams/team/media/")
    expect(canonicalObjectPrefix({ teamId: "team", scope: "media", path: ["2026"] })).toBe(
      "teams/team/media/2026/",
    )
  })

  it("refuses segments that could escape or rewrite a path", () => {
    const rejected: readonly (readonly string[])[] = [
      [".."],
      ["."],
      ["a/b"],
      ["a\\b"],
      [""],
      ["  leading"],
      ["trailing."],
      ["ok", ".."],
      ["nested..traversal"],
      ["percent%2e%2e"],
      ["new\nline"],
      ["null\u0000byte"],
      ["-leading-dash"],
    ]

    for (const path of rejected) {
      expect(() => objectKey({ teamId: "team", scope: "media", path }), path.join("|")).toThrow(
        InvalidObjectKeyError,
      )
    }
  })

  it("requires a path and rejects unsafe team and scope segments", () => {
    expect(() => objectKey({ teamId: "team", scope: "media", path: [] })).toThrow(
      /at least one path segment/,
    )
    expect(() => objectKey({ teamId: "../other", scope: "media", path: ["a.png"] })).toThrow(
      InvalidObjectKeyError,
    )
    expect(() => objectKey({ teamId: "team", scope: "../media", path: ["a.png"] })).toThrow(
      InvalidObjectKeyError,
    )
  })

  it("applies segment, depth, and total length limits", () => {
    expect(() =>
      objectKey({ teamId: "team", scope: "media", path: Array.from({ length: 9 }, () => "part") }),
    ).toThrow(/at most 8 segments/)
    expect(() => objectKey({ teamId: "team", scope: "media", path: ["a".repeat(129)] })).toThrow(
      /longer than 128 characters/,
    )
    expect(() =>
      objectKey(
        { teamId: "team", scope: "media", path: ["a".repeat(120), "b".repeat(120)] },
        { maximumPathSegments: 8, maximumSegmentLength: 128, maximumCanonicalKeyLength: 64 },
      ),
    ).toThrow(/longer than 64 characters/)
  })

  it("reads back the keys an adapter reports", () => {
    const key = parseCanonicalObjectKey("teams/team/media/2026/cover.png")

    expect(key).toEqual({ teamId: "team", scope: "media", path: ["2026", "cover.png"] })
    expect(
      objectKeysEqual(key, { teamId: "team", scope: "media", path: ["2026", "cover.png"] }),
    ).toBe(true)
  })

  it("refuses adapter paths that are not tenant scoped", () => {
    for (const canonical of [
      "media/2026/cover.png",
      "teams/team",
      "/teams/team/media/cover.png",
      "teams/team/media/../escape.png",
      "TEAMS/team/media/cover.png",
    ]) {
      expect(() => parseCanonicalObjectKey(canonical), canonical).toThrow(InvalidObjectKeyError)
    }
  })

  it("freezes validated keys so callers cannot repoint them later", () => {
    const key = objectKey({ teamId: "team", scope: "media", path: ["cover.png"] })

    expect(Object.isFrozen(key)).toBe(true)
    expect(Object.isFrozen(key.path)).toBe(true)
  })

  it("ignores inherited and accessor properties on caller supplied paths", () => {
    const path = Object.create({ 0: "inherited.png" }) as string[]
    Object.defineProperty(path, "length", { value: 1 })

    expect(() => objectKey({ teamId: "team", scope: "media", path })).toThrow(InvalidObjectKeyError)

    const accessorPath = ["placeholder.png"]
    Object.defineProperty(accessorPath, "0", { get: () => "sneaky.png" })

    expect(() => objectKey({ teamId: "team", scope: "media", path: accessorPath })).toThrow(
      /data properties/,
    )
  })
})

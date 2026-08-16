import { describe, expect, it } from "vitest"
import {
  calendarTargets,
  configuredCalendarTargets,
  socialPlatformById,
} from "../src/lib/social-platforms"

describe("social platform definitions", () => {
  it("defines the supported account and calendar platforms in one place", () => {
    expect(calendarTargets).toEqual(["X", "LinkedIn", "Instagram"])
    expect(socialPlatformById.instagram).toMatchObject({
      name: "Instagram",
      calendarTarget: "Instagram",
    })
  })

  it("only exposes calendar targets backed by configured accounts", () => {
    expect(configuredCalendarTargets([
      { platform: "linkedin" },
      { platform: "twitter" },
      { platform: "twitter" },
    ])).toEqual(["X", "LinkedIn"])
    expect(configuredCalendarTargets([])).toEqual([])
  })
})

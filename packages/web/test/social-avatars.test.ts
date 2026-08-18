import {
  createMemoryObjectStoreAdapter,
  createObjectStore,
  type ObjectStore,
} from "@screeem/object-storage"
import { Effect } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  socialAvatarDataUrl,
  socialAvatarKey,
  socialAvatarScopes,
  type SocialAvatarRequest,
  type UpstreamAvatar,
} from "../src/lib/storage/social-avatars"

const request: SocialAvatarRequest = {
  teamId: "5f2b8c1e-8a1d-4d3f-9a2b-0c7e6d5f4a3b",
  accountId: "9c1d0b7a-2e3f-4a5b-8c9d-0e1f2a3b4c5d",
  platform: "twitter",
  handle: "screeem",
}

describe("social avatar cache", () => {
  let store: ObjectStore
  let scheduled: (() => Promise<void>)[]

  beforeEach(() => {
    store = createObjectStore(createMemoryObjectStoreAdapter(), { scopes: socialAvatarScopes })
    scheduled = []
  })

  it("fetches once and serves later calls from team storage", async () => {
    const fetchUpstream = vi.fn(async () => avatar("image/png"))

    const first = await socialAvatarDataUrl(request, options({ fetchUpstream }))
    expect(first).toBe("data:image/png;base64,AAEC")
    expect(fetchUpstream).toHaveBeenCalledTimes(1)

    // Storing happens after the response, so the object only exists once the
    // scheduled work has run.
    await drain()

    const second = await socialAvatarDataUrl(request, options({ fetchUpstream }))
    expect(second).toBe("data:image/png;base64,AAEC")
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it("keeps each team's avatar under its own key", async () => {
    const fetchUpstream = vi.fn(async () => avatar("image/png"))

    await socialAvatarDataUrl(request, options({ fetchUpstream }))
    await drain()

    const otherTeam = { ...request, teamId: "0a1b2c3d-0000-4000-8000-000000000009" }
    await socialAvatarDataUrl(otherTeam, options({ fetchUpstream }))
    await drain()

    expect(fetchUpstream).toHaveBeenCalledTimes(2)
    await expect(head(socialAvatarKey(request.teamId, request.accountId))).resolves.toBe(true)
    await expect(head(socialAvatarKey(otherTeam.teamId, otherTeam.accountId))).resolves.toBe(true)
  })

  it("serves a stale avatar immediately and refreshes it after the response", async () => {
    const fetchUpstream = vi
      .fn<() => Promise<UpstreamAvatar>>()
      .mockResolvedValueOnce(avatar("image/png"))
      .mockResolvedValueOnce({ bytes: Uint8Array.from([9, 9, 9]), contentType: "image/png" })

    await socialAvatarDataUrl(request, options({ fetchUpstream }))
    await drain()

    const eightDaysLater = () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000)
    const stale = await socialAvatarDataUrl(
      request,
      options({ fetchUpstream, now: eightDaysLater }),
    )

    expect(stale).toBe("data:image/png;base64,AAEC")
    expect(fetchUpstream).toHaveBeenCalledTimes(1)

    await drain()
    expect(fetchUpstream).toHaveBeenCalledTimes(2)

    const refreshed = await socialAvatarDataUrl(request, options({ fetchUpstream }))
    expect(refreshed).toBe("data:image/png;base64,CQkJ")
  })

  it("reports no avatar when the upstream service has none", async () => {
    const fetchUpstream = vi.fn(async () => null)

    expect(await socialAvatarDataUrl(request, options({ fetchUpstream }))).toBeUndefined()
    await drain()
    await expect(head(socialAvatarKey(request.teamId, request.accountId))).resolves.toBe(false)
  })

  it("still serves an avatar the scope will not hold, without logging a fault", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchUpstream = vi.fn(async () => avatar("image/svg+xml"))

    const served = await socialAvatarDataUrl(request, options({ fetchUpstream }))
    await drain()

    expect(served).toBe("data:image/svg+xml;base64,AAEC")
    await expect(head(socialAvatarKey(request.teamId, request.accountId))).resolves.toBe(false)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it("keeps each account in a team under its own key", async () => {
    const fetchUpstream = vi
      .fn<() => Promise<UpstreamAvatar>>()
      .mockResolvedValueOnce({ bytes: Uint8Array.from([1, 1, 1]), contentType: "image/png" })
      .mockResolvedValueOnce({ bytes: Uint8Array.from([2, 2, 2]), contentType: "image/png" })
    const second = { ...request, accountId: "1b2c3d4e-0000-4000-8000-00000000000c" }

    await socialAvatarDataUrl(request, options({ fetchUpstream }))
    await socialAvatarDataUrl(second, options({ fetchUpstream }))
    await drain()

    // A shared key would serve one account's picture under the other's post.
    expect(await socialAvatarDataUrl(request, options({ fetchUpstream }))).toBe(
      "data:image/png;base64,AQEB",
    )
    expect(await socialAvatarDataUrl(second, options({ fetchUpstream }))).toBe(
      "data:image/png;base64,AgIC",
    )
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
  })

  it("serves the upstream avatar when a storage defect rejects the read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchUpstream = vi.fn(async () => avatar("image/png"))
    const defective: ObjectStore = {
      ...store,
      // How the storage layer reports a broken adapter: a defect, not a typed
      // failure, so it rejects rather than landing in the error channel.
      get: () => Effect.die(new TypeError("adapter bug")),
    }

    const served = await socialAvatarDataUrl(request, options({ fetchUpstream, store: defective }))

    expect(served).toBe("data:image/png;base64,AAEC")
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("reports no avatar when the store cannot be built at all", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchUpstream = vi.fn(async () => avatar("image/png"))

    // A misconfigured deployment throws while constructing the store, which
    // must not take the whole tool call down with it.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("NODE_ENV", "production")

    const served = await socialAvatarDataUrl(request, {
      fetchUpstream,
      schedule: async (task) => {
        scheduled.push(task)
      },
    })

    expect(served).toBeUndefined()
    expect(error).toHaveBeenCalled()
    vi.unstubAllEnvs()
    error.mockRestore()
  })

  it("survives background work that fails after the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchUpstream = vi.fn(async () => avatar("image/png"))
    const defective: ObjectStore = { ...store, put: () => Effect.die(new TypeError("adapter bug")) }

    expect(await socialAvatarDataUrl(request, options({ fetchUpstream, store: defective }))).toBe(
      "data:image/png;base64,AAEC",
    )
    await expect(drain()).resolves.toBeUndefined()

    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("serves the upstream avatar when storage is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchUpstream = vi.fn(async () => avatar("image/png"))
    const broken: ObjectStore = {
      ...store,
      get: () => Effect.fail(new Error("storage down") as never),
      put: () => Effect.fail(new Error("storage down") as never),
    }

    const served = await socialAvatarDataUrl(request, options({ fetchUpstream, store: broken }))
    await drain()

    expect(served).toBe("data:image/png;base64,AAEC")
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  function options(overrides: {
    fetchUpstream: () => Promise<UpstreamAvatar | null>
    store?: ObjectStore
    now?: () => Date
  }) {
    return {
      store: overrides.store ?? store,
      fetchUpstream: overrides.fetchUpstream,
      schedule: async (task: () => Promise<void>) => {
        scheduled.push(task)
      },
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    }
  }

  async function drain(): Promise<void> {
    const tasks = [...scheduled]
    scheduled = []
    for (const task of tasks) await task()
  }

  async function head(key: ReturnType<typeof socialAvatarKey>): Promise<boolean> {
    const result = await Effect.runPromise(Effect.either(store.head(key)))
    return result._tag === "Right"
  }
})

function avatar(contentType: string): UpstreamAvatar {
  return { bytes: Uint8Array.from([0, 1, 2]), contentType }
}

import { describe, expect, it, vi } from "vitest"
import { loadActivePublicDefinition, type PublicFormRecord } from "../src/lib/forms/public"

describe("published form cache", () => {
  it("keeps only the bounded set of most recently used publications", async () => {
    let reads = 0
    const admin = fakeAdmin(async () => {
      reads += 1
      return { data: publishedRow(), error: null }
    })
    const forms = Array.from({ length: 17 }, (_, index) => publicForm(`cache-form-${index}`))

    for (const form of forms) await loadActivePublicDefinition(admin, form)
    await loadActivePublicDefinition(admin, forms[0]!)

    expect(reads).toBe(18)
  })

  it("retries a publication load after a rejected query", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("temporary database failure") })
      .mockResolvedValueOnce({ data: publishedRow(), error: null })
    const admin = fakeAdmin(load)
    const form = publicForm("cache-retry-form")

    await expect(loadActivePublicDefinition(admin, form)).rejects.toThrow(
      "temporary database failure",
    )
    await expect(loadActivePublicDefinition(admin, form)).resolves.toMatchObject({
      formId: form.id,
      version: 1,
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("caches runtime actions without retaining editor authoring data", async () => {
    const admin = fakeAdmin(async () => ({
      data: publishedRow({
        version: 1,
        rules: [
          {
            id: "qualified",
            when: "true",
            route: "sales",
            actions: [{ use: "notify", with: "({ email: submission.email })" }],
          },
        ],
        fallback: "review",
        authoring: { version: 1, rules: [], fallback: "review" },
      }),
      error: null,
    }))

    const published = await loadActivePublicDefinition(admin, publicForm("cache-compact-form"))

    expect(published?.routing?.rules[0]).toEqual({
      id: "qualified",
      when: "true",
      route: "sales",
      actions: [{ use: "notify", with: "({ email: submission.email })" }],
    })
    expect(published?.routing).not.toHaveProperty("authoring")
  })
})

function publicForm(id: string): PublicFormRecord {
  return {
    id,
    teamId: "team-cache-tests",
    allowedOrigin: null,
    successUrl: null,
    legacyUnstructured: false,
    definitionAvailability: "active",
    publishedVersion: 1,
    requiresTurnstile: false,
    submissionSchema: null,
  }
}

function publishedRow(routing_definition: unknown = null) {
  return {
    definition: {
      formatVersion: 1,
      title: "Cached form",
      submitLabel: "Submit",
      successMessage: "Thanks",
      fields: [
        {
          id: "email-field",
          name: "email",
          label: "Email",
          required: true,
          type: "string",
          control: "email",
        },
      ],
    },
    routing_definition,
    published_at: "2026-08-13T00:00:00.000Z",
  }
}

function fakeAdmin(load: () => Promise<unknown>) {
  const query = {
    from: () => query,
    select: () => query,
    eq: () => query,
    maybeSingle: load,
  }
  return query as never
}

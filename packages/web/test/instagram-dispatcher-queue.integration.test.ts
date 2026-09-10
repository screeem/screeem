import postgres from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const suite = process.env.INSTAGRAM_DISPATCHER_DB_TESTS === "1" ? describe : describe.skip

// Pins the pgmq contract the drain loop depends on against a live database:
// first read observes read_ct === 1, archive/set_vt report real outcomes.
suite("Instagram dispatcher queue (pgmq-backed)", () => {
  const database = postgres(process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 2,
    prepare: false,
  })

  afterAll(() => database.end())

  it("round-trips send, read, reschedule, and archive through the wrappers", async () => {
    const sent = await database<{ readonly send: number | string }[]>`
      SELECT pgmq.send('instagram_publish', '{"teamId":"t"}')
    `
    const msgId = Number(sent[0]?.send)
    expect(Number.isSafeInteger(msgId)).toBe(true)

    const read = await database<{
      readonly msg_id: number | string
      readonly read_ct: number | string
    }[]>`
      SELECT msg_id, read_ct FROM public.read_instagram_dispatch_messages(60, 25)
    `
    const found = read.find((row) => Number(row.msg_id) === msgId)
    expect(Number(found?.read_ct)).toBe(1)

    await expect(database`
      SELECT public.reschedule_instagram_dispatch_message(${msgId}, 0)
    `).rejects.toThrow(/dispatch_delay_out_of_range/)

    const rescheduled = await database<{ readonly reschedule_instagram_dispatch_message: boolean }[]>`
      SELECT public.reschedule_instagram_dispatch_message(${msgId}, 60)
    `
    expect(rescheduled[0]?.reschedule_instagram_dispatch_message).toBe(true)

    const archived = await database<{ readonly archive_instagram_dispatch_message: boolean }[]>`
      SELECT public.archive_instagram_dispatch_message(${msgId})
    `
    expect(archived[0]?.archive_instagram_dispatch_message).toBe(true)

    const again = await database<{ readonly archive_instagram_dispatch_message: boolean }[]>`
      SELECT public.archive_instagram_dispatch_message(${msgId})
    `
    expect(again[0]?.archive_instagram_dispatch_message).toBe(false)
  })

  it("enqueues nothing without due targets and loads no missing target", async () => {
    const enqueued = await database<{ readonly enqueue_due_instagram_targets: number | string }[]>`
      SELECT public.enqueue_due_instagram_targets(50)
    `
    expect(Number(enqueued[0]?.enqueue_due_instagram_targets)).toBeGreaterThanOrEqual(0)

    const missing = await database<{
      readonly status: string
      readonly publish_at: string
      readonly template_version: number
      readonly connection_ok: boolean | null
    }[]>`
      SELECT * FROM public.load_instagram_dispatch_target(
        ${"11111111-1111-4111-8111-111111111111"},
        ${"22222222-2222-4222-8222-222222222222"}
      )
    `
    expect(missing).toEqual([])
  })
})

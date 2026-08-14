import { after } from "next/server"

export async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task)
  } catch {
    await task()
  }
}

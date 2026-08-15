import "server-only"

import postgres from "postgres"

let database: ReturnType<typeof postgres> | undefined

export function getDatabase() {
  if (database) return database
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")
  database = postgres(url, {
    max: 2,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: 12_000 },
  })
  return database
}

import { NextRequest, NextResponse } from "next/server"
import {
  PublicDefinitionUnavailableError,
  findPublicForm,
  loadActivePublicDefinition,
} from "@/lib/forms/public"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ endpointKey: string }> },
) {
  const { endpointKey } = await context.params
  const origin = request.headers.get("origin")
  const admin = createAdminClient()

  try {
    const form = await findPublicForm(admin, endpointKey)
    if (!form) return notFound()
    if (!originIsAllowed(request, origin, form.allowedOrigin)) {
      return NextResponse.json({ error: "Origin is not allowed" }, { status: 403 })
    }

    const published = await loadActivePublicDefinition(admin, form)
    if (!published) return notFound()

    return NextResponse.json(
      {
        version: published.version,
        definition: published.definition,
        publishedAt: published.publishedAt,
      },
      {
        headers: {
          ...cors(origin, form.allowedOrigin),
          "Cache-Control": "no-store",
        },
      },
    )
  } catch (error) {
    if (error instanceof PublicDefinitionUnavailableError) return notFound()
    return NextResponse.json({ error: "Could not load form" }, { status: 500 })
  }
}

function notFound() {
  return NextResponse.json({ error: "Form not found" }, { status: 404 })
}

function cors(origin: string | null, allowed: string | null): Record<string, string> {
  if (!allowed) return { "Access-Control-Allow-Origin": "*" }
  return origin === allowed ? { "Access-Control-Allow-Origin": allowed, Vary: "Origin" } : {}
}

function originIsAllowed(
  request: NextRequest,
  origin: string | null,
  allowed: string | null,
): boolean {
  if (!allowed || origin === null || origin === allowed) return true
  return (
    origin === request.nextUrl.origin && request.headers.get("sec-fetch-site") === "same-origin"
  )
}

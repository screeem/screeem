import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isDevelopmentPlayground =
    process.env.NODE_ENV !== "production" && (pathname === "/_dev" || pathname.startsWith("/_dev/"))
  const isPublicFormSubmissionRoute = /^\/api\/forms\/[^/]+\/submissions\/?$/.test(pathname)
  const isPublicFormDefinitionRoute = /^\/api\/forms\/[^/]+\/?$/.test(pathname)
  const isHostedFormRoute = /^\/forms\/[^/]+\/?$/.test(pathname)
  const isPublicApiRoute = pathname === "/api/openapi" || pathname.startsWith("/api/v1/")

  if (
    isDevelopmentPlayground ||
    isPublicFormSubmissionRoute ||
    isPublicFormDefinitionRoute ||
    isHostedFormRoute ||
    isPublicApiRoute
  ) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthRoute = pathname.startsWith("/auth")
  const isMcpRoute = pathname.startsWith("/api/mcp")
  const isOAuthRoute = pathname.startsWith("/oauth") || pathname.startsWith("/.well-known")

  if (
    !user &&
    !isAuthRoute &&
    !isMcpRoute &&
    !isPublicFormSubmissionRoute &&
    !isPublicFormDefinitionRoute &&
    !isHostedFormRoute &&
    !isPublicApiRoute &&
    !isOAuthRoute
  ) {
    const loginUrl = new URL("/auth/login", request.url)
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  if (user && isAuthRoute && !pathname.startsWith("/auth/callback")) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}

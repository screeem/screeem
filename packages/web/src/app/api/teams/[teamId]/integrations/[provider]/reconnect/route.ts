import { NextRequest } from "next/server"

import { beginSocialOAuth } from "@/lib/integrations/social/api"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; provider: string }> },
) {
  return beginSocialOAuth(request, context, true)
}

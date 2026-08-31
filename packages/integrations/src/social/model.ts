export const socialProviderNames = ["instagram", "tiktok"] as const

export type SocialProviderName = (typeof socialProviderNames)[number]

export interface SocialAuthorizationRequest {
  readonly redirectUri: string
  /** Host-generated, single-use CSRF value. Providers return it unchanged. */
  readonly state: string
  readonly forceReauthorization?: boolean
}

export interface SocialAuthorization {
  readonly provider: SocialProviderName
  readonly url: string
  readonly state: string
  readonly scopes: readonly string[]
}

export interface SocialCodeExchangeRequest {
  readonly code: string
  readonly redirectUri: string
  /** Exact redirect URI stored with the consumed OAuth attempt. */
  readonly expectedRedirectUri: string
  /** State returned by the provider callback. */
  readonly state: string
  /** Single-use state loaded and consumed by the host for this OAuth attempt. */
  readonly expectedState: string
}

export interface SocialCredentialBase {
  readonly provider: SocialProviderName
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresInSeconds: number
  readonly refreshExpiresInSeconds: number | null
  readonly scopes: readonly string[]
  readonly accountId: string
}

export interface SocialAccountProfile {
  readonly provider: SocialProviderName
  readonly id: string
  /** A public handle when the granted provider scopes expose one. */
  readonly username: string | null
  readonly displayName: string
  readonly pictureUrl: string | null
}

export interface ConnectedSocialAccount<Credential extends SocialCredentialBase> {
  readonly credential: Credential
  readonly account: SocialAccountProfile
}

export interface SocialCredentialRevocation {
  readonly status: "revoked" | "already_inactive"
}

export type SocialPublishPhase = "processing" | "published" | "failed"

export interface SocialProviderDescription {
  readonly provider: SocialProviderName
  readonly scopes: readonly string[]
  readonly media: readonly ("image" | "video")[]
}

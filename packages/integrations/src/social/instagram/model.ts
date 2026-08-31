import type {
  SocialAccountProfile,
  SocialCredentialBase,
  SocialPublishPhase,
} from "../model.js"

export interface InstagramCredential extends SocialCredentialBase {
  readonly provider: "instagram"
  /** Instagram refreshes the long-lived access token itself. */
  readonly refreshToken: null
  readonly refreshExpiresInSeconds: null
}

export interface InstagramAccountProfile extends SocialAccountProfile {
  readonly provider: "instagram"
  readonly username: string
}

export type InstagramMedia =
  | {
      readonly kind: "image"
      readonly url: string
      readonly altText?: string
    }
  | {
      readonly kind: "video"
      readonly url: string
      readonly coverTimestampMs?: number
    }

export interface InstagramPublishRequest {
  readonly caption: string
  readonly media: readonly InstagramMedia[]
  readonly isAiGenerated?: boolean
}

interface InstagramPublishReceiptBase {
  readonly provider: "instagram"
  readonly accountId: string
  /** Exact normalized media approved for this dispatch. */
  readonly media: readonly InstagramMedia[]
  /** Number of media items with acknowledged child-container IDs. */
  readonly nextMediaIndex: number
  readonly childContainerIds: readonly string[]
  readonly containerId: string | null
  readonly caption: string
  readonly isAiGenerated: boolean | null
}

/** Server-only state. Persist each transition and serialize advancement per receipt. */
export type InstagramPublishReceipt =
  | InstagramPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "processing">
      readonly mediaId: null
      readonly failureReason: null
    }
  | InstagramPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "published">
      /** Null only when status polling recovered a publish whose response was lost. */
      readonly mediaId: string | null
      readonly failureReason: null
    }
  | InstagramPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "failed">
      readonly mediaId: null
      readonly failureReason: string
    }

export interface InstagramProviderDescription {
  readonly provider: "instagram"
  readonly scopes: readonly string[]
  readonly media: readonly ["image", "video"]
  readonly apiVersion: string
  readonly maximumCarouselItems: number
}

import type {
  SocialAccountProfile,
  SocialCredentialBase,
  SocialPublishPhase,
} from "../model.js"

export const tiktokPrivacyLevels = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const

export type TikTokPrivacyLevel = (typeof tiktokPrivacyLevels)[number]

export interface TikTokCredential extends SocialCredentialBase {
  readonly provider: "tiktok"
  readonly refreshToken: string
  readonly refreshExpiresInSeconds: number
}

export interface TikTokAccountProfile extends SocialAccountProfile {
  readonly provider: "tiktok"
  readonly username: null
}

export interface TikTokCreatorInfo {
  readonly username: string
  readonly displayName: string
  readonly pictureUrl: string | null
  readonly privacyLevels: readonly TikTokPrivacyLevel[]
  readonly commentsDisabled: boolean
  readonly duetDisabled: boolean
  readonly stitchDisabled: boolean
  readonly maximumVideoDurationSeconds: number
}

interface TikTokDirectPostOptions {
  readonly privacyLevel: TikTokPrivacyLevel
  readonly disableComment: boolean
  readonly brandedContent: boolean
  readonly ownBrandContent: boolean
  /** Must only be set after the user explicitly confirms this exact post. */
  readonly userConsent: true
}

export interface TikTokVideoPublishRequest extends TikTokDirectPostOptions {
  readonly kind: "video"
  readonly title: string
  /** Duration measured from the source media before the user confirms the post. */
  readonly durationSeconds: number
  /** Public HTTPS URL under a domain or URL prefix verified with TikTok. */
  readonly url: string
  readonly disableDuet: boolean
  readonly disableStitch: boolean
  readonly coverTimestampMs?: number
  readonly isAiGenerated: boolean
}

export interface TikTokPhotoPublishRequest extends TikTokDirectPostOptions {
  readonly kind: "photos"
  readonly title?: string
  readonly description?: string
  /** Public HTTPS URLs under a domain or URL prefix verified with TikTok. */
  readonly urls: readonly string[]
  readonly coverIndex: number
  readonly autoAddMusic?: boolean
  readonly isAiGenerated: boolean
}

export type TikTokPublishRequest = TikTokVideoPublishRequest | TikTokPhotoPublishRequest

interface TikTokPublishReceiptBase {
  /** Receipts are authority-bearing server state and must not be accepted from a client. */
  readonly provider: "tiktok"
  readonly accountId: string
  readonly publishId: string
}

export type TikTokPublishReceipt =
  | TikTokPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "processing">
      readonly postIds: readonly []
      readonly failureReason: null
    }
  | TikTokPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "published">
      readonly postIds: readonly string[]
      readonly failureReason: null
    }
  | TikTokPublishReceiptBase & {
      readonly phase: Extract<SocialPublishPhase, "failed">
      readonly postIds: readonly []
      readonly failureReason: string
    }

export interface TikTokProviderDescription {
  readonly provider: "tiktok"
  readonly scopes: readonly string[]
  readonly media: readonly ["image", "video"]
  readonly maximumPhotoItems: number
  readonly transfer: "pull_from_verified_url"
  readonly verifiedMediaUrlPrefixes: readonly string[]
}

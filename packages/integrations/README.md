# `@screeem/integrations`

`@screeem/integrations` provides Instagram and TikTok OAuth and publishing
adapters through provider-specific exports:

```text
packages/integrations/src/social/
  instagram/
  tiktok/
```

The package currently implements Instagram Login and publishing, and TikTok
Login Kit and Direct Post. It has no database, queue, framework, or UI
dependency.

## Boundary

Both adapters expose Effects for:

- building an authorization URL from a host-generated OAuth state;
- exchanging an authorization code and resolving the connected account;
- refreshing credentials;
- revoking provider access before disconnecting locally;
- reading the account profile;
- starting an asynchronous publish;
- advancing a persisted publish receipt to its next state.

Expected failures are tagged values in `SocialIntegrationFailure`. Transport,
authorization, rate-limit, provider rejection, invalid request, invalid
provider response, and uncertain publish outcomes remain distinct. A
`SocialPublishUncertainError` means a non-idempotent provider mutation may have
succeeded but no authoritative acknowledgement arrived. It must never enter an
automatic retry path.

The host application still owns:

- one-time OAuth state generation, storage, expiry, replay prevention, and
  binding to the initiating user/team and exact redirect URI;
- encrypted credential persistence and calculated token expiry timestamps;
- team/account authorization and connect/reconnect UI;
- scheduled jobs, durable dispatch attempts, retry policy, and receipt persistence;
- polling or webhook workers and user-visible publish status;
- storing media at public provider-compatible URLs and probing the real media
  bytes for provider codec, dimensions, duration, and size limits.

`exchangeCode()` requires the callback `state`/`redirectUri` and the matching
`expectedState`/`expectedRedirectUri` loaded from the host's consumed OAuth
attempt. The package validates their shape and exact equality; the host remains
responsible for expiry, single use, and tenant/user binding.

Credentials and the HTTP client are secret-bearing server-side values. Encrypt
credentials at rest, never send them to a browser, and never log or serialize
request URLs, headers, or bodies. Some provider token endpoints necessarily put
secrets in form/query parameters. A custom `SocialHttpClient` is therefore a
trusted boundary and must redact all request telemetry.

`revokeCredential()` returns `revoked`, or `already_inactive` only when the
provider explicitly proves the whole app grant was removed. An expired TikTok
access token is not proof because its refresh grant may still be valid: refresh
first, then revoke. Other authorization and transport failures do not prove the
remote grant was removed. If the host falls back to deleting an unusable local
credential, it must tell the user to remove the app from the provider account.

That division is deliberate: this package understands provider protocols;
Screeem decides who may connect an account and when a post should run.

## Instagram

```ts
import { Effect } from "effect"
import { createInstagramProvider } from "@screeem/integrations/social/instagram"

const program = Effect.gen(function* () {
  const instagram = yield* createInstagramProvider({
    clientId: process.env.INSTAGRAM_CLIENT_ID!,
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET!,
  })

  return yield* instagram.authorizationUrl({
    redirectUri: "https://app.example.com/api/integrations/instagram/callback",
    state: "host_generated_single_use_state",
  })
})
```

The default scopes are `instagram_business_basic` and
`instagram_business_content_publish`. Code exchange upgrades the short-lived
token to a long-lived token. The adapter publishes an image, Reel, or carousel
and models the acknowledged child-container, carousel, and final-publish states
as receipt transitions.

### Scheduled post contracts

Scheduling input and durable delivery state are separate Effect Schema
contracts. A browser may submit a schedule and an immutable asset reference:

```ts
const input = {
  schema: "screeem.instagram-scheduled-post-input",
  schemaVersion: 1,
  schedule: {
    publishAt: "2026-09-01T17:30:00.000Z",
    timezone: "Europe/London",
  },
  template: {
    kind: "instagram.image",
    version: 1,
    caption: "A scheduled image",
    isAiGenerated: false,
    image: {
      asset: {
        schema: "screeem.social-media-asset",
        schemaVersion: 1,
        assetId: "10000000-0000-4000-8000-000000000006",
        checksum: "sha256:<64 lowercase hex characters>",
      },
      altText: "A desk by a window",
    },
  },
}
```

The server verifies that asset reference, inspects the exact stored bytes, and
creates `ScheduledInstagramPostV1`. That durable target adds the authorized
team, calendar revision, connection, actor, and inspected media metadata. Those
fields are deliberately absent from `InstagramScheduledPostInputV1`; never
accept the durable shape from a browser.

Image V1 accepts server-inspected standard JPEG and excludes extended JPEG
formats. Reel V1 records the inspected container, codec, frame rate, dimensions,
duration, file size, and audio/video bitrates, and requires an explicit
`shareToFeed` choice. Carousel V1 contains two to ten image items. V1 does not
support carousel video; add it only after defining a separate `VIDEO` media
profile. Templates store immutable asset IDs and checksums, never provider fetch
URLs. The worker resolves a short-lived public URL from the trusted asset record
immediately before dispatch.

Envelope and asset-reference shapes use `schemaVersion`; template variants use
`version`. Unknown fields are rejected. An unsupported version produces
`UnsupportedInstagramPostVersionError`, while malformed data produces
`InvalidInstagramPostContractError`. Any field or meaning change gets a new
version and decoder; the provider Graph API version remains a separate concern.
Encode decoded values before JSON persistence because timestamps and timezones
decode to Effect values.

Before dispatch, re-check the exact calendar revision, approval, connection and
account binding, current publishing quota, current provider capabilities, and
the inspected asset checksum. An edited post supersedes its old immutable
target instead of mutating a claimed delivery in place.

Meta does not provide idempotency keys for these mutations. Persist a durable
dispatch attempt before calling `publish()` and provide both `publish()` and
`advancePublish()` a `SocialPublishPersistence` boundary. Its `claim` callback
must atomically acquire the initial dispatch lease or authenticate and lease the
exact stored receipt revision before any provider I/O. Its `acknowledge` callback
must durably compare-and-swap the returned revision.
Instagram creates one carousel child per acknowledged advancement, so a later
rate limit never loses earlier child IDs. If any create/publish acknowledgement
is lost, the adapter returns `SocialPublishUncertainError`; quarantine that
attempt for reconciliation instead of retrying it.

The Instagram app must be configured and reviewed for the requested permissions.
The target account must be supported by the Instagram API. See Meta's
[Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
and [content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
documentation.

## TikTok

```ts
import { createTikTokProvider } from "@screeem/integrations/social/tiktok"

const tiktok = yield* createTikTokProvider({
  clientKey: process.env.TIKTOK_CLIENT_KEY!,
  clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
  verifiedMediaUrlPrefixes: ["https://media.example.com/social/"],
})
```

The default scopes are `user.info.basic` and `video.publish`. The adapter uses
`PULL_FROM_URL` for videos and photos, rejects URLs outside the configured
TikTok-verified HTTPS directory prefixes, queries creator capabilities before
every publish, validates the user's privacy and interaction choices, checks
video duration against the account limit, and returns a receipt for status
polling. Photo posts support up to 35 images.

The web UI must also query `getCreatorInfo()` while rendering the post screen.
TikTok requires the current account name, a manually chosen privacy level,
user-controlled interaction and commercial-content options, a preview, and
explicit consent before sending. Do not replace those controls with defaults.
The publish request requires explicit commercial-content, AI-generation, and
per-post consent fields so an omitted form value cannot silently become false.
The host must bind that consent to the connected account, immutable media
version, canonical post revision, selected controls, approving user, and time;
editing any covered field invalidates consent and requires a new confirmation.

TikTok Direct Post requires Content Posting API access and approval for
`video.publish`. Unaudited clients are private-only and subject to low test
limits. Public posting requires audit approval, and pulled media must use a
domain or URL prefix verified in the TikTok developer portal. See TikTok's
[Direct Post guide](https://developers.tiktok.com/docs/en/content-posting-api-get-started),
[API reference](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post),
and [content-sharing rules](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

Audit approval is a product requirement, not merely an API toggle. A private
team-only uploader may be rejected; the shipped experience must satisfy
TikTok's creator-facing preview, editability, disclosure, consent, branding,
and anti-watermark rules.

## Scheduling across providers

At the scheduled instant, the worker loads each selected account and refreshes
only credentials that are eligible and near expiry, then starts the provider
Effects concurrently and persists each result separately. For Instagram,
persist host metadata for when the long-lived token was issued and do not call
refresh until it is at least 24 hours old and still unexpired.
“At the same time” means the worker dispatches them together; neither platform
guarantees the exact same public visibility timestamp because both process media
asynchronously.

`publish()` and `advancePublish()` require the claim/acknowledgement boundary
described above. The package invokes both callbacks through Effect, catches
synchronous defects, and waits at most five seconds for each persistence step.
After a non-idempotent provider success, acknowledgement runs in a supervised
daemon fiber so caller interruption cannot cancel the durable commit; a timeout
is reported as an uncertain outcome. Use driver-level database deadlines too.
A partial failure must not roll back a post already accepted by another provider.

Receipts are authority-bearing server state: never accept a receipt supplied by
a browser. Load it by an opaque host-owned ID scoped to the tenant, connection,
and scheduled post, then make `claim(receipt)` verify the complete stored value,
revision, scope, and lease before it succeeds. Only one worker may initiate or
advance a publish at a time. TikTok and
Instagram publish initiation are non-idempotent, so persist the dispatch attempt
first and route `SocialPublishUncertainError` to manual/provider reconciliation,
never an automatic retry.

This package validates declared metadata and URL policy; it does not download
or decode media. Run a trusted media probe/normalization step before the user
confirms a post, then keep those exact normalized bytes available at the
submitted URLs until provider processing completes. TikTok pull URLs must not
redirect and must remain directly accessible for at least the full one-hour
download window.

## Verification

```bash
pnpm --filter @screeem/integrations typecheck
pnpm --filter @screeem/integrations test
pnpm --filter @screeem/integrations build
```

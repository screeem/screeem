# `@screeem/object-storage`

Read and write tenant-scoped objects through one validated port. The package owns
key safety, scope policy, and limits; a backend adapter only moves bytes. No
provider client is a dependency, so the same store runs against Supabase
Storage, an S3 compatible service, or memory.

## Why a port and a policy layer

Storage rules are easy to get wrong once per call site. Instead of trusting each
caller, every operation is validated before an adapter is reached:

- **Keys carry their tenant.** A key is `{ teamId, scope, path }`, rendered as
  `teams/<teamId>/<scope>/<...path>`. Nothing addresses an object by raw string,
  so a request cannot drift into another team's prefix.
- **Segments are narrow.** Traversal, absolute paths, separators, percent
  encoding, and control characters are unrepresentable rather than escaped.
- **Scopes declare what they accept.** Each scope names its content types and
  byte ceiling up front, so a new upload surface cannot silently widen what a
  bucket will hold.
- **Failures are typed.** Expected refusals live in the Effect error channel.
  A broken adapter or a caller passing the wrong type is a defect, never a
  storage rule.

## Usage

```ts
import {
  createMemoryObjectStoreAdapter,
  createObjectStore,
  ObjectNotFoundError,
} from "@screeem/object-storage"
import { Effect } from "effect"

const store = createObjectStore(createMemoryObjectStoreAdapter(), {
  scopes: [
    {
      scope: "post-media",
      allowedContentTypes: ["image/png", "image/jpeg"],
      maximumByteLength: 5 * 1024 * 1024,
      signedUrl: { defaultSeconds: 300, maximumSeconds: 900 },
    },
  ],
})

const key = { teamId, scope: "post-media", path: ["2026", "cover.png"] }

const program = Effect.gen(function* () {
  const written = yield* store.put({ key, bytes, contentType: "image/png" })
  const download = yield* store.createDownloadUrl(key, { expiresInSeconds: 60 })
  return { etag: written.etag, url: download.url }
})
```

Every method returns an `Effect`. Hosts that call from a Promise boundary run
them the same way the rest of the codebase does:

```ts
const result = await Effect.runPromise(Effect.either(program))

if (Either.isLeft(result)) {
  return objectStorageErrorResponse(result.left)
}
```

## Reads, writes, and concurrency

`put` accepts an optional precondition:

- `{ kind: "absent" }` — first writer wins. A second write fails with
  `ObjectAlreadyExistsError`.
- `{ kind: "etag", etag }` — read-modify-write. A stale tag fails with
  `ObjectPreconditionFailedError`, which carries the current tag so the caller
  can re-read and retry. This is the same recovery shape as a form revision
  conflict.

`delete` accepts the entity tag precondition only.

## Large payloads

`put` and `get` move bytes through the caller, which suits objects that are
already in memory. Anything user-sized should use `createUploadUrl` and
`createDownloadUrl` so bytes travel directly between the browser and the
backend. Signed URLs report the ceiling they were issued for, and expiry is
bounded per scope.

Streaming reads and writes are deliberately absent. Adding them would tie the
port to one runtime's stream type; signed URLs cover the same need today.

## Listings

`list` takes a prefix and returns one page with an opaque cursor. Listings carry
system metadata only — content type, byte length, entity tag, cache lifetime —
matching object storage conventions. Read an object to see the metadata a caller
wrote.

## Metadata

Names are `snake_case` in which an underscore always introduces a letter, which
keeps the mapping reversible for backends that report metadata in camel case.
Values are short strings with no control characters, so no adapter has to escape
a line break on the way into a header. Values outside ASCII are an adapter's
responsibility to encode.

## Cache lifetime

`cacheMaxAgeSeconds` is a number of seconds, not a directive string. Backends
render the header themselves, so no caller composes response header syntax and
nothing needs escaping on the way out.

## Adapters

`createMemoryObjectStoreAdapter` is included for tests, the development
playground, and hosts with no bucket configured. It copies every payload it
stores, so callers cannot mutate stored bytes afterwards, and derives entity
tags from content, so rewriting identical bytes keeps the same tag.

A backend implements `ObjectStoreAdapter`: seven methods over canonical paths,
failing with the package's error types. Validation is already done by the time
an adapter is called.

Screeem's Supabase Storage adapter lives in the web application at
`packages/web/src/lib/storage/supabase-object-store.ts`, alongside the other
provider bindings.

## Contract tests

Adapters share one behavioural suite, so a new backend proves itself against the
same cases as memory:

```ts
import {
  objectStoreContractCases,
  objectStoreContractScopes,
} from "@screeem/object-storage/testing"

for (const testCase of objectStoreContractCases(() => ({
  store: createObjectStore(adapter, { scopes: objectStoreContractScopes }),
  teams: { primary, secondary },
}))) {
  it(testCase.name, testCase.run)
}
```

Cases clean up the objects they write and are prefixed per case, so they can run
against a shared bucket. Backends that enforce row level security supply real
team identifiers.

## Errors

| Error                           | Code                         | Meaning                                           |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| `InvalidObjectKeyError`         | `invalid_object_key`         | The key cannot be represented safely              |
| `InvalidObjectRequestError`     | `invalid_object_request`     | Options fall outside policy or limits             |
| `ObjectNotFoundError`           | `object_not_found`           | Nothing is stored at the key                      |
| `ObjectAlreadyExistsError`      | `object_already_exists`      | A first-writer-wins write lost                    |
| `ObjectPreconditionFailedError` | `object_precondition_failed` | The entity tag no longer matches                  |
| `ObjectTooLargeError`           | `object_too_large`           | The payload exceeds the scope or bucket ceiling   |
| `UnsupportedContentTypeError`   | `unsupported_content_type`   | The scope does not accept the content type        |
| `ObjectStorageUnavailableError` | `object_storage_unavailable` | The backend refused, failed, or answered unusably |

All extend `ObjectStorageError`, so hosts can map by code or by instance.

## Commands

```bash
make check   # typecheck, shuffled tests, build, and format check
make test    # run the test suite
```

import "server-only"

import {
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  type IntegrationIdentifier,
  type IntegrationProviderName,
} from "./contract"
import {
  SealedIntegrationCredential,
  snapshotSealedIntegrationCredential,
} from "./stores"

export interface IntegrationCredentialScope {
  readonly teamId: IntegrationIdentifier
  readonly connectionId: IntegrationIdentifier
  readonly provider: IntegrationProviderName
}

export interface IntegrationCredentialCipher {
  seal(scope: IntegrationCredentialScope, value: unknown): Promise<SealedIntegrationCredential>
  open(scope: IntegrationCredentialScope, credential: SealedIntegrationCredential): Promise<unknown>
}

export class AesGcmIntegrationCredentialCipher implements IntegrationCredentialCipher {
  private constructor(
    private readonly keyId: string,
    private readonly key: CryptoKey,
  ) {}

  static async create(keyId: string, encodedKey: string) {
    const configuration = snapshotIntegrationCredentialKeyConfiguration(keyId, encodedKey)
    const bytes = decodeBase64Url(configuration.encodedKey)
    const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
    return new AesGcmIntegrationCredentialCipher(configuration.keyId, key)
  }

  async seal(scope: IntegrationCredentialScope, value: unknown) {
    const safeScope = snapshotCredentialScope(scope)
    let serialized: string
    try {
      const candidate = JSON.stringify(value)
      if (typeof candidate !== "string") throw new TypeError("Invalid integration credential payload")
      serialized = candidate
    } catch {
      throw new TypeError("Invalid integration credential payload")
    }
    const plaintext = new TextEncoder().encode(serialized)
    if (plaintext.byteLength === 0 || plaintext.byteLength > 65_536) {
      throw new TypeError("Invalid integration credential payload")
    }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: scopeBytes(safeScope), tagLength: 128 },
      this.key,
      plaintext,
    )
    return SealedIntegrationCredential.create(
      this.keyId,
      `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`,
    )
  }

  async open(scope: IntegrationCredentialScope, input: SealedIntegrationCredential) {
    const safeScope = snapshotCredentialScope(scope)
    const credential = snapshotSealedIntegrationCredential(input)
    if (credential.keyId !== this.keyId) {
      throw new IntegrationCredentialCipherError("credential_key_unavailable")
    }
    const parts = credential.sealed.split(".")
    if (parts.length !== 3 || parts[0] !== "v1") {
      throw new IntegrationCredentialCipherError("invalid_credential")
    }
    try {
      const iv = decodeBase64Url(parts[1])
      const encrypted = decodeBase64Url(parts[2])
      if (iv.byteLength !== 12 || encrypted.byteLength < 16) throw new Error("invalid")
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: scopeBytes(safeScope), tagLength: 128 },
        this.key,
        encrypted,
      )
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted)) as unknown
    } catch (error) {
      if (error instanceof IntegrationCredentialCipherError) throw error
      throw new IntegrationCredentialCipherError("invalid_credential")
    }
  }
}

export function snapshotIntegrationCredentialKeyConfiguration(keyId: unknown, encodedKey: unknown) {
  if (typeof keyId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) {
    throw new TypeError("Invalid integration credential key ID")
  }
  if (typeof encodedKey !== "string" || decodeBase64Url(encodedKey).byteLength !== 32) {
    throw new TypeError("Integration credential key must contain 32 bytes")
  }
  return Object.freeze({ keyId, encodedKey })
}

export type IntegrationCredentialCipherErrorCode =
  | "credential_key_unavailable"
  | "invalid_credential"

export class IntegrationCredentialCipherError extends Error {
  constructor(readonly code: IntegrationCredentialCipherErrorCode) {
    super("Unable to open integration credential")
    this.name = "IntegrationCredentialCipherError"
  }
}

function snapshotCredentialScope(input: IntegrationCredentialScope): IntegrationCredentialScope {
  return Object.freeze({
    teamId: snapshotIntegrationIdentifier(input.teamId),
    connectionId: snapshotIntegrationIdentifier(input.connectionId),
    provider: snapshotIntegrationProviderName(input.provider),
  })
}

function scopeBytes(scope: IntegrationCredentialScope) {
  return new TextEncoder().encode(`${scope.teamId}\n${scope.connectionId}\n${scope.provider}`)
}

function encodeBase64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url")
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Invalid base64url value")
  return new Uint8Array(Buffer.from(value, "base64url"))
}

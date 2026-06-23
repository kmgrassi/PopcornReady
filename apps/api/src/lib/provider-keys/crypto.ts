// Symmetric encryption for user-supplied provider API keys.
//
// Keys are encrypted at rest (AES-256-GCM) so a DB read never exposes the raw
// secret. The write path (the provider-api-keys route) encrypts; the generation
// path (resolveProviderApiKey) decrypts. Both share this module so the format
// can never drift between them.
//
// Ciphertext format: `v1.<iv>.<tag>.<ciphertext>` (each segment base64url).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/core/errors";

const VERSION = "v1";

// The encryption key is derived from a dedicated secret, falling back to the
// service-role key so existing deploys work without new config. Set
// PROVIDER_API_KEYS_ENCRYPTION_SECRET explicitly to rotate independently.
function encryptionKey(): Buffer {
  const secret =
    process.env.PROVIDER_API_KEYS_ENCRYPTION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    throw new ApiError(
      "not_implemented",
      "Provider key storage needs PROVIDER_API_KEYS_ENCRYPTION_SECRET or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

// Reverse of encryptApiKey. Throws on a malformed/tampered payload (GCM auth tag
// mismatch) rather than returning a bad key.
export function decryptApiKey(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`Unrecognized provider key ciphertext format`);
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// Short, non-reversible display hint (e.g. "sk-a••••wxyz") for the settings UI.
export function keyHint(apiKey: string): string {
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
  );
  return base64UrlEncode(digest);
}

async function encryptionKey(): Promise<CryptoKey> {
  const configured = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!configured) {
    throw new Error(
      "Missing required server configuration: GMAIL_TOKEN_ENCRYPTION_KEY",
    );
  }
  const raw = base64UrlDecode(configured);
  if (raw.byteLength !== 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key",
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    asArrayBuffer(raw),
    "AES-GCM",
    false,
    [
      "encrypt",
      "decrypt",
    ],
  );
}

export async function encryptJson(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      asArrayBuffer(encoder.encode(JSON.stringify(value))),
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function decryptJson<T>(value: string): Promise<T> {
  const [version, ivValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted payload");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(base64UrlDecode(ivValue)) },
    await encryptionKey(),
    asArrayBuffer(base64UrlDecode(ciphertextValue)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

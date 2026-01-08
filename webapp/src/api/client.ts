const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

let webAppSessionKey = "";

export function setWebAppSessionKey(sessionKey: string): void {
  webAppSessionKey = sessionKey;
}

function encodeHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const message = encoder.encode(payload);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return encodeHex(signature);
}

function buildSignaturePayload(
  timestamp: number,
  nonce: string,
  body: string
): string {
  return `${timestamp}.${nonce}.${body}`;
}

async function buildSignedHeaders(body: unknown): Promise<Record<string, string>> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const rawBody = JSON.stringify(body ?? {});
  const payload = buildSignaturePayload(timestamp, nonce, rawBody);
  if (!webAppSessionKey) {
    throw new Error("Missing WebApp session key");
  }
  const signature = await hmacSha256(payload, webAppSessionKey);

  return {
    "x-webapp-timestamp": String(timestamp),
    "x-webapp-nonce": nonce,
    "x-webapp-signature": signature,
    "x-webapp-session": webAppSessionKey,
  };
}

export async function postJson<T>(
  url: string,
  body: unknown
): Promise<T> {
  const signedHeaders = await buildSignedHeaders(body);
  const response = await fetch(url, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...signedHeaders },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

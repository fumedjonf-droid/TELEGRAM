const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const signPayload = async (payload: string, secret: string) => {
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
};

type SessionState = {
  sessionId: string;
  sessionKey: string;
  expiresAt: number;
};

let sessionState: SessionState | null = null;
let sessionPromise: Promise<SessionState> | null = null;

const fetchSession = async (initData?: string | null): Promise<SessionState> => {
  if (!initData) {
    throw new Error("Missing Telegram initData");
  }
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TG-INIT-DATA": initData,
    },
    body: JSON.stringify({ initData }),
  });
  if (!response.ok) {
    throw new Error(`Session request failed: ${response.status}`);
  }
  const data = (await response.json()) as { sessionId: string; sessionKey: string; expiresAt: number };
  return { sessionId: data.sessionId, sessionKey: data.sessionKey, expiresAt: data.expiresAt };
};

const getSession = async (initData?: string | null): Promise<SessionState> => {
  const now = Date.now();
  if (sessionState && sessionState.expiresAt > now + 30_000) {
    return sessionState;
  }
  if (!sessionPromise) {
    sessionPromise = fetchSession(initData).finally(() => {
      sessionPromise = null;
    });
  }
  sessionState = await sessionPromise;
  return sessionState;
};

export const getSignedHeaders = async ({
  method,
  url,
  bodyString,
}: {
  method: string;
  url: string;
  bodyString: string;
}) => {
  const initData = window.Telegram?.WebApp?.initData ?? null;
  const session = await getSession(initData);
  const timestamp = Date.now();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = toHex(nonceBytes.buffer);
  const payload = `${timestamp}.${nonce}.${method}.${url}.${bodyString}`;
  const signature = await signPayload(payload, session.sessionKey);
  return {
    "X-Session-Id": session.sessionId,
    "X-Request-Timestamp": String(timestamp),
    "X-Request-Nonce": nonce,
    "X-Request-Signature": signature,
  };
};

export const apiClient = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const initData = window.Telegram?.WebApp?.initData;
  const body = options?.body;
  const bodyString =
    body instanceof FormData ? "" : typeof body === "string" ? body : body ? JSON.stringify(body) : "";
  const signatureHeaders = await getSignedHeaders({
    method: options?.method ?? "GET",
    url,
    bodyString,
  });
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(initData ? { "X-TG-INIT-DATA": initData } : {}),
      ...signatureHeaders,
      ...(options?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

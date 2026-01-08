import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { markUserSuspected } from "../db/schema";

type LogContext = Record<string, unknown>;

type RateState = {
  lastActionAt: number;
  windowStart: number;
  count: number;
};

const ID_CHECK_COOLDOWN_MS = 20_000;
const ORDER_CREATE_COOLDOWN_MS = 10_000;
const WINDOW_MS = 5 * 60_000;
const MAX_ID_CHECKS = 5;
const MAX_ORDER_CREATES = 12;

const idCheckLimits = new Map<string, RateState>();
const orderCreateLimits = new Map<string, RateState>();

const SIGNATURE_TOLERANCE_MS = 5 * 60_000;
const SESSION_TTL_MS = 5 * 60_000;
const seenNonces = new Map<string, number>();
const sessionKeys = new Map<string, { key: string; expiresAt: number }>();

function sanitizeLogContext(context: LogContext): LogContext {
  const redacted = new Set([
    "initData",
    "email",
    "phone",
    "first_name",
    "last_name",
    "botToken",
    "token",
    "signature",
    "nonce",
    "sessionKey",
    "x-webapp-signature",
    "x-webapp-nonce",
  ]);
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (redacted.has(key)) {
        return [key, "[redacted]"];
      }
      return [key, value];
    })
  );
}

function safeLog(message: string, context: LogContext = {}): void {
  console.info(message, sanitizeLogContext(context));
}

function getOrInitState(map: Map<string, RateState>, userId: string): RateState {
  const existing = map.get(userId);
  if (existing) {
    return existing;
  }
  const initial = { lastActionAt: 0, windowStart: Date.now(), count: 0 };
  map.set(userId, initial);
  return initial;
}

function enforceLimits(
  map: Map<string, RateState>,
  userId: string,
  cooldownMs: number,
  windowMs: number,
  maxCount: number,
  label: string
): void {
  const state = getOrInitState(map, userId);
  const now = Date.now();
  if (now - state.lastActionAt < cooldownMs) {
    markUserSuspected(userId, `${label} cooldown violation`);
    throw new Error("Cooldown limit exceeded");
  }
  if (now - state.windowStart > windowMs) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= maxCount) {
    markUserSuspected(userId, `${label} rate limit exceeded`);
    throw new Error("Rate limit exceeded");
  }
  state.lastActionAt = now;
  state.count += 1;
}

export function enforceIdCheckLimits(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const userId = String(req.body?.userId ?? "");
  try {
    enforceLimits(
      idCheckLimits,
      userId,
      ID_CHECK_COOLDOWN_MS,
      WINDOW_MS,
      MAX_ID_CHECKS,
      "id-check"
    );
    next();
  } catch (error) {
    safeLog("ID check blocked", { userId, error: (error as Error).message });
    next(error);
  }
}

export function enforceOrderCreateLimits(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const userId = String(req.body?.userId ?? "");
  try {
    enforceLimits(
      orderCreateLimits,
      userId,
      ORDER_CREATE_COOLDOWN_MS,
      WINDOW_MS,
      MAX_ORDER_CREATES,
      "order-create"
    );
    next();
  } catch (error) {
    safeLog("Order creation blocked", {
      userId,
      error: (error as Error).message,
    });
    next(error);
  }
}

function hmacSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneSeenNonces(now: number): void {
  for (const [nonce, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) {
      seenNonces.delete(nonce);
    }
  }
}

function getSignaturePayload(req: Request): string {
  const timestamp = String(req.headers["x-webapp-timestamp"] ?? "");
  const nonce = String(req.headers["x-webapp-nonce"] ?? "");
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  return `${timestamp}.${nonce}.${rawBody}`;
}

function pruneExpiredSessions(now: number): void {
  for (const [userId, session] of sessionKeys.entries()) {
    if (session.expiresAt <= now) {
      sessionKeys.delete(userId);
    }
  }
}

export function issueWebAppSessionKey(
  userId: string,
  initDataVerified: boolean
): { sessionKey: string; expiresAt: number } {
  if (!initDataVerified) {
    throw new Error("initData verification failed");
  }
  const sessionKey = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessionKeys.set(userId, { key: sessionKey, expiresAt });
  return { sessionKey, expiresAt };
}

export function verifyWebAppSignature(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const timestamp = Number(req.headers["x-webapp-timestamp"] ?? 0);
  const nonce = String(req.headers["x-webapp-nonce"] ?? "");
  const signature = String(req.headers["x-webapp-signature"] ?? "");
  const sessionKey = String(req.headers["x-webapp-session"] ?? "");
  const userId = String(req.body?.userId ?? "");
  const now = Date.now();
  pruneSeenNonces(now);
  pruneExpiredSessions(now);

  if (!timestamp || !nonce || !signature || !sessionKey || !userId) {
    next(new Error("Missing signature headers"));
    return;
  }
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_MS) {
    next(new Error("Signature timestamp expired"));
    return;
  }
  if (seenNonces.has(nonce)) {
    next(new Error("Replay detected"));
    return;
  }
  const storedSession = sessionKeys.get(userId);
  if (!storedSession || storedSession.expiresAt <= now) {
    next(new Error("Session expired"));
    return;
  }
  if (!timingSafeEquals(storedSession.key, sessionKey)) {
    next(new Error("Invalid session"));
    return;
  }

  const payload = getSignaturePayload(req);
  const expected = hmacSignature(payload, storedSession.key);
  if (!timingSafeEquals(expected, signature)) {
    next(new Error("Invalid signature"));
    return;
  }

  seenNonces.set(nonce, now + SIGNATURE_TOLERANCE_MS);
  next();
}

export function logRequestSummary(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  safeLog("Incoming request", {
    method: req.method,
    path: req.path,
    userId: req.body?.userId,
  });
  next();
}

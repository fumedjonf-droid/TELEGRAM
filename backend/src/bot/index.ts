import { randomUUID } from "crypto";
import {
  clearUserSuspicion,
  getSuspicionSummary,
  markUserSuspected,
} from "../db/schema";

type Role = "admin" | "ops" | "support" | "viewer";
type Permission =
  | "confirm"
  | "refund"
  | "edit_price"
  | "broadcast"
  | "suspicion_manage";

interface UserContext {
  id: string;
  role: Role;
}

const permissionsByRole: Record<Role, Permission[]> = {
  admin: ["confirm", "refund", "edit_price", "broadcast", "suspicion_manage"],
  ops: ["confirm", "refund", "edit_price", "suspicion_manage"],
  support: ["refund"],
  viewer: [],
};

function hasPermission(user: UserContext, permission: Permission): boolean {
  return permissionsByRole[user.role].includes(permission);
}

function requirePermission(user: UserContext, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new Error("Insufficient permissions");
  }
}

const CONFIRMATION_TTL_MS = 30_000;
const pendingConfirmations = new Map<
  string,
  { action: string; token: string; expiresAt: number }
>();

function createConfirmation(userId: string, action: string): string {
  const token = randomUUID();
  const expiresAt = Date.now() + CONFIRMATION_TTL_MS;
  pendingConfirmations.set(userId, { action, token, expiresAt });
  return token;
}

function consumeConfirmation(
  userId: string,
  action: string,
  token: string
): boolean {
  const pending = pendingConfirmations.get(userId);
  if (!pending) {
    return false;
  }
  if (pending.action !== action || pending.token !== token) {
    return false;
  }
  if (pending.expiresAt < Date.now()) {
    pendingConfirmations.delete(userId);
    return false;
  }
  pendingConfirmations.delete(userId);
  return true;
}

type LogValue = Record<string, unknown>;

function sanitizeLogValue(value: LogValue): LogValue {
  const redactedKeys = new Set([
    "initData",
    "email",
    "phone",
    "first_name",
    "last_name",
    "botToken",
    "token",
    "signature",
    "nonce",
  ]);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (redactedKeys.has(key)) {
        return [key, "[redacted]"];
      }
      return [key, item];
    })
  );
}

function safeLog(message: string, context: LogValue = {}): void {
  const sanitized = sanitizeLogValue(context);
  console.info(message, sanitized);
}

export function approvePayment(
  user: UserContext,
  paymentId: string,
  confirmationToken?: string
): { status: "pending" | "approved"; token?: string } {
  requirePermission(user, "confirm");
  if (!confirmationToken) {
    const token = createConfirmation(user.id, `approve-payment:${paymentId}`);
    safeLog("Payment approval confirmation requested", {
      userId: user.id,
      paymentId,
    });
    return { status: "pending", token };
  }
  const confirmed = consumeConfirmation(
    user.id,
    `approve-payment:${paymentId}`,
    confirmationToken
  );
  if (!confirmed) {
    throw new Error("Confirmation expired or invalid");
  }
  safeLog("Payment approved", { userId: user.id, paymentId });
  return { status: "approved" };
}

export function refundPayment(user: UserContext, paymentId: string): void {
  requirePermission(user, "refund");
  safeLog("Payment refund initiated", { userId: user.id, paymentId });
}

export function updatePrice(
  user: UserContext,
  orderId: string,
  newPrice: number
): void {
  requirePermission(user, "edit_price");
  safeLog("Order price updated", { userId: user.id, orderId, newPrice });
}

export function broadcastAnnouncement(
  user: UserContext,
  message: string
): void {
  requirePermission(user, "broadcast");
  safeLog("Broadcast created", { userId: user.id, messageLength: message.length });
}

export function markSuspiciousUser(
  user: UserContext,
  targetId: string,
  reason: string
): void {
  requirePermission(user, "suspicion_manage");
  markUserSuspected(targetId, reason);
  safeLog("User marked suspicious", { userId: user.id, targetId });
}

export function clearSuspiciousUser(
  user: UserContext,
  targetId: string
): void {
  requirePermission(user, "suspicion_manage");
  clearUserSuspicion(targetId);
  safeLog("User suspicion cleared", { userId: user.id, targetId });
}

export function getSuspicionStatus(
  user: UserContext,
  targetId: string
): { isSuspected: boolean; score: number; history: string[] } {
  requirePermission(user, "suspicion_manage");
  const summary = getSuspicionSummary(targetId);
  safeLog("Suspicion status requested", { userId: user.id, targetId });
  return summary;
}

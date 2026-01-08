import { getDb, nowIso } from "../db/index.js";

export type PaymentType = "dc" | "card";

const SETTING_KEYS = {
  dc: "payment_dc_requisites",
  card: "payment_card_requisites",
} as const;

export const getPaymentSettings = () => {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN (?, ?)")
    .all(SETTING_KEYS.dc, SETTING_KEYS.card) as { key: string; value: string }[];
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    dc: map.get(SETTING_KEYS.dc) ?? null,
    card: map.get(SETTING_KEYS.card) ?? null,
  };
};

export const setPaymentSetting = (type: PaymentType, value: string, adminId: string) => {
  const db = getDb();
  const now = nowIso();
  const key = SETTING_KEYS[type];
  db.prepare(
    "INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
  ).run(key, value, adminId, now);
  db.prepare(
    "INSERT INTO payment_history (type, value, changed_by, created_at) VALUES (?, ?, ?, ?)"
  ).run(type, value, adminId, now);
};

export const deletePaymentSetting = (type: PaymentType, adminId: string) => {
  const db = getDb();
  const now = nowIso();
  const key = SETTING_KEYS[type];
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  db.prepare(
    "INSERT INTO payment_history (type, value, changed_by, created_at) VALUES (?, ?, ?, ?)"
  ).run(type, "", adminId, now);
};

export const getNumericSetting = (key: string, fallback: number) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) {
    return fallback;
  }
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

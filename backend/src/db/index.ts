import Database from "better-sqlite3";
import { config } from "../config.js";
import { schemaSql } from "./schema.js";

export type Db = Database.Database;

let dbInstance: Db | null = null;

export const getDb = (): Db => {
  if (!dbInstance) {
    dbInstance = new Database(config.SQLITE_PATH);
    dbInstance.pragma("foreign_keys = ON");
    dbInstance.exec(schemaSql);
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_admins_telegram_id ON admins(telegram_id);"
    );
  }
  return dbInstance;
};

export const nowIso = (): string => new Date().toISOString();

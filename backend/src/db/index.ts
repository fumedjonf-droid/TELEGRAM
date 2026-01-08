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
    try {
      dbInstance.exec("ALTER TABLE users ADD COLUMN updated_at TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0");
    } catch {
      // ignore if exists
    }
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_admins_telegram_id ON admins(telegram_id);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_order_outbox_processed ON order_outbox(processed_at, event_type);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_order_items_item_id ON order_items(item_id);"
    );
    dbInstance.exec(
      "CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);"
    );
  }
  return dbInstance;
};

export const nowIso = (): string => new Date().toISOString();

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
    try {
      dbInstance.exec("ALTER TABLE users ADD COLUMN is_suspected INTEGER DEFAULT 0");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE categories ADD COLUMN game_key TEXT NOT NULL DEFAULT 'default'");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE categories ADD COLUMN region TEXT NOT NULL DEFAULT 'global'");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE categories ADD COLUMN id_rules TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE categories ADD COLUMN provider_key TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE categories ADD COLUMN delivery_type TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN game_key TEXT NOT NULL DEFAULT 'default'");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN region TEXT NOT NULL DEFAULT 'global'");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN id_rules TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN provider_key TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN delivery_type TEXT");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE items ADD COLUMN sort_order INTEGER DEFAULT 0");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN game_key TEXT NOT NULL DEFAULT 'default'");
    } catch {
      // ignore if exists
    }
    try {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN nickname_snapshot TEXT");
    } catch {
      // ignore if exists
    }
    dbInstance.exec(
      `CREATE TABLE IF NOT EXISTS order_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        changed_by TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );`
    );
    try {
      const adminsTable = dbInstance
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admins'")
        .get() as { sql?: string } | undefined;
      if (adminsTable?.sql && !adminsTable.sql.includes("'support'")) {
        dbInstance.exec(`
          CREATE TABLE IF NOT EXISTS admins_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'moderator', 'support')),
            added_by TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          INSERT INTO admins_new (id, telegram_id, role, added_by, created_at)
          SELECT id, telegram_id, role, added_by, created_at FROM admins;
          DROP TABLE admins;
          ALTER TABLE admins_new RENAME TO admins;
        `);
      }
    } catch {
      // ignore migration errors
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

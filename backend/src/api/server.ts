import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { getDb, nowIso } from "../db/index.js";
import { isValidGameId, isValidQuantity } from "../utils/validators.js";
import { parseUserFromInitData, validateInitData } from "../services/telegramAuth.js";

const upload = multer({ storage: multer.memoryStorage() });

export const createServer = () => {
  const app = express();
  app.use(express.json());

  app.post("/api/auth/telegram", (req, res) => {
    const { initData } = req.body as { initData?: string };
    if (!initData || !validateInitData(initData, config.BOT_TOKEN)) {
      return res.status(401).json({ error: "invalid_init_data" });
    }
    const user = parseUserFromInitData(initData);
    if (!user) {
      return res.status(400).json({ error: "missing_user" });
    }
    const db = getDb();
    const now = nowIso();
    const existing = db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(user.id) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE users SET last_seen_at = ?, username = ?, first_name = ? WHERE id = ?")
        .run(now, user.username ?? null, user.first_name ?? null, existing.id);
    } else {
      db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
      ).run(user.id, user.username ?? null, user.first_name ?? null, now, now);
    }
    return res.json({ ok: true, telegramId: user.id });
  });

  app.get("/api/items", (_req, res) => {
    const db = getDb();
    const items = db
      .prepare(
        "SELECT id, name, description, price, category_id as categoryId, image_url as imageUrl, image_file_id as imageFileId, is_active as isActive FROM items WHERE is_active = 1"
      )
      .all();
    res.json(items);
  });

  app.get("/api/categories", (_req, res) => {
    const db = getDb();
    const categories = db
      .prepare(
        "SELECT id, name, icon_url as iconUrl, sort_order as sortOrder, is_active as isActive FROM categories WHERE is_active = 1 ORDER BY sort_order ASC"
      )
      .all();
    res.json(categories);
  });

  app.post("/api/orders", (req, res) => {
    const { telegramId, gameId, paymentMethod, items } = req.body as {
      telegramId?: string;
      gameId?: string;
      paymentMethod?: string;
      items?: { itemId: number; qty: number }[];
    };

    if (!telegramId || !gameId || !paymentMethod || !items?.length) {
      return res.status(400).json({ error: "missing_fields" });
    }
    if (!isValidGameId(gameId)) {
      return res.status(400).json({ error: "invalid_game_id" });
    }

    const db = getDb();
    const user = db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(telegramId) as { id: number } | undefined;
    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }
    const existingPending = db
      .prepare(
        "SELECT id FROM orders WHERE user_id = ? AND status IN ('pending', 'awaiting_proof', 'paid_review') LIMIT 1"
      )
      .get(user.id) as { id: number } | undefined;
    if (existingPending) {
      return res.status(429).json({ error: "active_order_exists" });
    }

    const itemIds = items.map((item) => item.itemId);
    const dbItems = db
      .prepare(
        `SELECT id, price FROM items WHERE is_active = 1 AND id IN (${itemIds.map(() => "?").join(", ")})`
      )
      .all(...itemIds) as { id: number; price: number }[];

    if (dbItems.length !== itemIds.length) {
      return res.status(400).json({ error: "invalid_items" });
    }

    const priceMap = new Map(dbItems.map((item) => [item.id, item.price]));
    let total = 0;
    for (const item of items) {
      if (!isValidQuantity(item.qty)) {
        return res.status(400).json({ error: "invalid_qty" });
      }
      total += (priceMap.get(item.itemId) ?? 0) * item.qty;
    }

    const now = nowIso();
    const result = db
      .prepare(
        "INSERT INTO orders (user_id, game_id, status, total_amount, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(user.id, gameId, "pending", total, paymentMethod, now, now);

    const orderId = Number(result.lastInsertRowid);
    const insertOrderItem = db.prepare(
      "INSERT INTO order_items (order_id, item_id, qty, price_snapshot) VALUES (?, ?, ?, ?)"
    );
    for (const item of items) {
      insertOrderItem.run(orderId, item.itemId, item.qty, priceMap.get(item.itemId));
    }

    return res.json({ orderId, status: "pending", totalAmount: total });
  });

  app.post("/api/orders/:id/proof", upload.single("file"), (req, res) => {
    const orderId = Number(req.params.id);
    const { proofFileId, proofType } = req.body as { proofFileId?: string; proofType?: string };

    if (!orderId) {
      return res.status(400).json({ error: "invalid_order" });
    }

    if (!proofFileId && !req.file) {
      return res.status(400).json({ error: "missing_proof" });
    }

    const db = getDb();
    const proofValue = proofFileId ?? "uploaded";
    const typeValue = proofType ?? (req.file ? "file" : null);
    const now = nowIso();
    const updated = db
      .prepare(
        "UPDATE orders SET proof_file_id = ?, proof_type = ?, proof_received_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(proofValue, typeValue, now, now, orderId);

    if (updated.changes === 0) {
      return res.status(404).json({ error: "order_not_found" });
    }

    return res.json({ ok: true });
  });

  app.post("/api/orders/:id/mark-paid", (req, res) => {
    const orderId = Number(req.params.id);
    if (!orderId) {
      return res.status(400).json({ error: "invalid_order" });
    }
    const db = getDb();
    const order = db
      .prepare("SELECT proof_file_id as proofFileId, status FROM orders WHERE id = ?")
      .get(orderId) as { proofFileId?: string; status: string } | undefined;

    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }
    if (!order.proofFileId) {
      return res.status(400).json({
        error: "proof_required",
        message:
          "❗️Чтобы мы подтвердили оплату, прикрепите чек/скрин оплаты (фото или файл). После отправки чека нажмите «Я оплатил(а)» ещё раз.",
      });
    }

    const now = nowIso();
    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(
      "paid_review",
      now,
      orderId
    );
    return res.json({ ok: true, status: "paid_review" });
  });

  return app;
};

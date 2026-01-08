import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import https from "https";
import { pipeline } from "stream";
import { promisify } from "util";
import { config } from "../config.js";
import { getDb, nowIso } from "../db/index.js";
import { isValidGameId, isValidQuantity } from "../utils/validators.js";
import { parseUserFromInitData, validateInitData } from "../services/telegramAuth.js";

const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const sanitizeFilename = (name: string) => {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(0, 64) || "file";
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

type AuthedRequest = express.Request & { user?: { telegramId: string; username?: string } };


const requireTelegramAuth = (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
  const initData = req.header("X-TG-INIT-DATA");
  if (!initData || !validateInitData(initData, config.BOT_TOKEN)) {
    return res.status(401).json({ error: "invalid_init_data" });
  }
  const user = parseUserFromInitData(initData);
  if (!user) {
    return res.status(400).json({ error: "missing_user" });
  }
  req.user = { telegramId: user.id, username: user.username };
  next();
};

export const createServer = () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(helmet());
  app.use(
    cors({
      origin: config.WEBAPP_ORIGIN,
      credentials: true,
    })
  );
  app.use(
    rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 60,
    })
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (_req, res) => {
    res.json({ ok: true, service: "telegram-shop-backend" });
  });

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
      db.prepare("UPDATE users SET last_seen_at = ?, username = ?, first_name = ?, updated_at = ? WHERE id = ?")
        .run(now, user.username ?? null, user.first_name ?? null, now, existing.id);
    } else {
      db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, created_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(user.id, user.username ?? null, user.first_name ?? null, now, now, now);
    }
    return res.json({ ok: true, telegramId: user.id });
  });

  app.get("/api/items", (_req, res) => {
    const db = getDb();
    const items = db
      .prepare(
        "SELECT id, name, description, price, category_id as categoryId, image_url as imageUrl, image_file_id as imageFileId, is_active as isActive FROM items WHERE is_active = 1"
      )
      .all() as {
      id: number;
      name: string;
      description?: string;
      price: number;
      categoryId?: number;
      imageUrl?: string | null;
      imageFileId?: string | null;
      isActive: number;
    }[];
    const mapped = items.map((item) => ({
      ...item,
      imageUrl: item.imageUrl ?? (item.imageFileId ? `/api/images/telegram/${item.imageFileId}` : null),
    }));
    res.json(mapped);
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

  const imageLimiter = rateLimit({ windowMs: 60_000, limit: 60 });

  app.get("/api/images/telegram/:fileId", imageLimiter, async (req, res) => {
    const fileId = req.params.fileId;
    if (!fileId) {
      return res.status(400).json({ error: "missing_file_id" });
    }
    const db = getDb();
    const exists = db
      .prepare("SELECT 1 FROM items WHERE image_file_id = ? LIMIT 1")
      .get(fileId) as { 1: number } | undefined;
    if (!exists) {
      return res.status(404).json({ error: "file_not_found" });
    }
    const metaUrl = `https://api.telegram.org/bot${config.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
    https
      .get(metaUrl, (metaResp) => {
        let data = "";
        metaResp.on("data", (chunk) => {
          data += chunk;
        });
        metaResp.on("end", async () => {
          try {
            const parsed = JSON.parse(data) as { ok: boolean; result?: { file_path?: string } };
            if (!parsed.ok || !parsed.result?.file_path) {
              return res.status(404).json({ error: "file_not_found" });
            }
            const filePath = parsed.result.file_path;
            const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${filePath}`;
            https
              .get(fileUrl, async (fileResp) => {
                const ct = filePath.endsWith(".png")
                  ? "image/png"
                  : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")
                    ? "image/jpeg"
                    : "application/octet-stream";
                res.setHeader("Content-Type", ct);
                res.setHeader("Cache-Control", "public, max-age=86400");
                try {
                  await pipe(fileResp, res);
                } catch {
                  res.status(500).end();
                }
              })
              .on("error", () => res.status(500).json({ error: "file_fetch_failed" }));
          } catch {
            return res.status(500).json({ error: "file_fetch_failed" });
          }
        });
      })
      .on("error", () => res.status(500).json({ error: "file_fetch_failed" }));
  });

  app.get("/api/payments", (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT key, value FROM settings WHERE key IN ('payment_dc_requisites', 'payment_card_requisites')"
      )
      .all() as { key: string; value: string }[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    res.json({
      dc: map.get("payment_dc_requisites") ?? null,
      card: map.get("payment_card_requisites") ?? null,
    });
  });

  app.post("/api/orders", requireTelegramAuth, (req: AuthedRequest, res) => {
    const { gameId, paymentMethod, items } = req.body as {
      gameId?: string;
      paymentMethod?: string;
      items?: { itemId: number; qty: number }[];
    };

    if (!req.user || !gameId || !paymentMethod || !items?.length) {
      return res.status(400).json({ error: "missing_fields" });
    }
    if (!["DC", "Карта", "dc", "card"].includes(paymentMethod)) {
      return res.status(400).json({ error: "invalid_payment_method" });
    }
    if (!isValidGameId(gameId)) {
      return res.status(400).json({ error: "invalid_game_id" });
    }

    const db = getDb();
    const user = db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(req.user.telegramId) as { id: number } | undefined;
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

  app.post("/api/orders/:id/proof", requireTelegramAuth, upload.single("file"), (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const { proofFileId, proofType } = req.body as { proofFileId?: string; proofType?: string };

    if (!orderId) {
      return res.status(400).json({ error: "invalid_order" });
    }

    if (!proofFileId && !req.file) {
      return res.status(400).json({ error: "missing_proof" });
    }

    const db = getDb();
    const order = db
      .prepare(
        "SELECT orders.id, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
      )
      .get(orderId) as { id: number; telegramId: string } | undefined;
    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }
    if (!req.user || order.telegramId !== req.user.telegramId) {
      return res.status(403).json({ error: "forbidden" });
    }
    const proofValue = proofFileId ?? null;
    const typeValue = proofType ?? (req.file ? req.file.mimetype : null);
    const proofPath = req.file ? req.file.path : null;
    const now = nowIso();
    const updated = db
      .prepare(
        "UPDATE orders SET proof_file_id = ?, proof_type = ?, proof_received_at = ?, proof_path = ?, updated_at = ? WHERE id = ?"
      )
      .run(proofValue, typeValue, now, proofPath, now, orderId);

    if (updated.changes === 0) {
      return res.status(404).json({ error: "order_not_found" });
    }

    return res.json({ ok: true });
  });

  app.post("/api/orders/:id/mark-paid", requireTelegramAuth, async (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    if (!orderId) {
      return res.status(400).json({ error: "invalid_order" });
    }
    const db = getDb();
    const order = db
      .prepare(
        "SELECT orders.id, orders.proof_file_id as proofFileId, orders.proof_path as proofPath, orders.status, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
      )
      .get(orderId) as
      | { proofFileId?: string; proofPath?: string | null; status: string; telegramId: string }
      | undefined;

    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }
    if (!req.user || order.telegramId !== req.user.telegramId) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!order.proofFileId && !order.proofPath) {
      return res.status(400).json({
        error: "proof_required",
        message:
          "❗️Чтобы мы подтвердили оплату, прикрепите чек/скрин оплаты (фото или файл). После отправки чека нажмите «Я оплатил(а)» ещё раз.",
      });
    }

    const now = nowIso();
    const result = db
      .prepare(
        "UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'awaiting_proof')"
      )
      .run("paid_review", now, orderId);
    if (result.changes === 0) {
      return res.status(409).json({ error: "invalid_status_transition" });
    }
    db.prepare(
      "INSERT INTO order_outbox (order_id, event_type, created_at) VALUES (?, ?, ?)"
    ).run(orderId, "order_ready_for_review", now);
    return res.json({ ok: true, status: "paid_review" });
  });

  app.get("/api/orders/my", requireTelegramAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const db = getDb();
    const orders = db
      .prepare(
        "SELECT orders.id, orders.status, orders.total_amount as totalAmount, orders.created_at as createdAt FROM orders JOIN users ON users.id = orders.user_id WHERE users.telegram_id = ? ORDER BY orders.created_at DESC"
      )
      .all(req.user.telegramId);
    res.json(orders);
  });

  app.get("/api/orders/:id", requireTelegramAuth, (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    if (!req.user || !orderId) {
      return res.status(400).json({ error: "invalid_order" });
    }
    const db = getDb();
    const order = db
      .prepare(
        "SELECT orders.id, orders.status, orders.total_amount as totalAmount, orders.game_id as gameId, orders.payment_method as paymentMethod, orders.proof_file_id as proofFileId, orders.proof_path as proofPath, orders.created_at as createdAt, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
      )
      .get(orderId) as
      | {
          id: number;
          status: string;
          totalAmount: number;
          gameId: string;
          paymentMethod: string;
          proofFileId?: string | null;
          proofPath?: string | null;
          createdAt: string;
          telegramId: string;
        }
      | undefined;
    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }
    if (order.telegramId !== req.user.telegramId) {
      return res.status(403).json({ error: "forbidden" });
    }
    const items = db
      .prepare(
        "SELECT items.name, order_items.qty, order_items.price_snapshot as priceSnapshot FROM order_items JOIN items ON items.id = order_items.item_id WHERE order_items.order_id = ?"
      )
      .all(orderId);
    return res.json({ ...order, items });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === "unsupported_file_type") {
      return res.status(400).json({ error: "unsupported_file_type" });
    }
    return res.status(500).json({ error: "internal_error" });
  });

  return app;
};
const pipe = promisify(pipeline);

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import https from "https";
import crypto from "crypto";
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

const webDist = path.resolve(process.cwd(), "../webapp/dist");
const hasWebDist = fs.existsSync(webDist);

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

const sendError = (res: express.Response, status: number, code: string, message?: string) =>
  res.status(status).json({ error: { code, message } });

const usedNonces = new Map<string, number>();
const sessionKeys = new Map<string, { key: string; expiresAt: number }>();
const identityCache = new Map<string, { expiresAt: number; nickname: string }>();

const cleanupNonces = () => {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces.entries()) {
    if (expiresAt <= now) {
      usedNonces.delete(nonce);
    }
  }
};

const cleanupSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessionKeys.entries()) {
    if (session.expiresAt <= now) {
      sessionKeys.delete(sessionId);
    }
  }
};

const cleanupIdentityCache = () => {
  const now = Date.now();
  for (const [key, entry] of identityCache.entries()) {
    if (entry.expiresAt <= now) {
      identityCache.delete(key);
    }
  }
};

const buildSignaturePayload = (req: express.Request) => {
  const timestamp = req.header("X-Request-Timestamp") ?? "";
  const nonce = req.header("X-Request-Nonce") ?? "";
  let bodyString = "";
  if (!req.is("multipart/form-data") && req.body && Object.keys(req.body).length > 0) {
    bodyString = JSON.stringify(req.body);
  }
  return `${timestamp}.${nonce}.${req.method}.${req.originalUrl}.${bodyString}`;
};

const verifySignedRequest = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith("/images/telegram") || req.path.startsWith("/auth/session")) {
    return next();
  }
  const sessionId = req.header("X-Session-Id");
  if (!sessionId) {
    return sendError(res, 401, "missing_session");
  }
  const timestampRaw = req.header("X-Request-Timestamp");
  const nonce = req.header("X-Request-Nonce");
  const signature = req.header("X-Request-Signature");
  if (!timestampRaw || !nonce || !signature) {
    return sendError(res, 401, "missing_signature");
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return sendError(res, 401, "invalid_signature");
  }
  const now = Date.now();
  if (Math.abs(now - timestamp) > 60_000) {
    return sendError(res, 401, "signature_expired");
  }
  cleanupNonces();
  cleanupSessions();
  const session = sessionKeys.get(sessionId);
  if (!session) {
    return sendError(res, 401, "invalid_session");
  }
  if (usedNonces.has(nonce)) {
    return sendError(res, 401, "signature_replay");
  }
  const payload = buildSignaturePayload(req);
  const expected = crypto
    .createHmac("sha256", session.key)
    .update(payload)
    .digest("hex");
  if (expected.length !== signature.length) {
    return sendError(res, 401, "invalid_signature");
  }
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return sendError(res, 401, "invalid_signature");
  }
  usedNonces.set(nonce, now + 5 * 60_000);
  return next();
};

const abuseTracker = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();

const checkCooldown = (key: string, limit: number, windowMs: number, cooldownMs: number) => {
  const now = Date.now();
  const entry = abuseTracker.get(key);
  if (!entry) {
    abuseTracker.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
    return { blocked: false };
  }
  if (entry.blockedUntil > now) {
    return { blocked: true };
  }
  if (now - entry.windowStart > windowMs) {
    entry.windowStart = now;
    entry.count = 1;
    entry.blockedUntil = 0;
    return { blocked: false };
  }
  entry.count += 1;
  if (entry.count > limit) {
    entry.blockedUntil = now + cooldownMs;
    return { blocked: true };
  }
  return { blocked: false };
};

const markSuspected = (telegramId: string) => {
  const db = getDb();
  db.prepare("UPDATE users SET is_suspected = 1, updated_at = ? WHERE telegram_id = ?").run(
    nowIso(),
    telegramId
  );
};

const recordStatus = (orderId: number, status: string, source: string, changedBy?: string | null) => {
  const db = getDb();
  db.prepare(
    "INSERT INTO order_status_history (order_id, status, changed_by, source, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(orderId, status, changedBy ?? null, source, nowIso());
};

const requireTelegramAuth = (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
  const initData = req.header("X-TG-INIT-DATA");
  if (!initData || !validateInitData(initData, config.BOT_TOKEN)) {
    return sendError(res, 401, "invalid_init_data");
  }
  const user = parseUserFromInitData(initData);
  if (!user) {
    return sendError(res, 400, "missing_user");
  }
  req.user = { telegramId: user.id, username: user.username };
  next();
};

export const createServer = () => {
  const app = express();
  app.set("trust proxy", 1);
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
      handler: (_req, res) => sendError(res, 429, "rate_limit_exceeded"),
    })
  );
  app.use(express.json());
  app.use("/api", verifySignedRequest);

  const orderLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    handler: (_req, res) => sendError(res, 429, "rate_limit_exceeded"),
  });
  const gameCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    handler: (_req, res) => sendError(res, 429, "rate_limit_exceeded"),
  });
  const identityLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    handler: (_req, res) => sendError(res, 429, "rate_limit_exceeded"),
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/auth/telegram", (req, res) => {
    const { initData } = req.body as { initData?: string };
    if (!initData || !validateInitData(initData, config.BOT_TOKEN)) {
      return sendError(res, 401, "invalid_init_data");
    }
    const user = parseUserFromInitData(initData);
    if (!user) {
      return sendError(res, 400, "missing_user");
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

  app.post("/api/auth/session", (req, res) => {
    const { initData } = req.body as { initData?: string };
    if (!initData || !validateInitData(initData, config.BOT_TOKEN)) {
      return sendError(res, 401, "invalid_init_data");
    }
    const user = parseUserFromInitData(initData);
    if (!user) {
      return sendError(res, 400, "missing_user");
    }
    const sessionId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 5 * 60_000;
    sessionKeys.set(sessionId, { key: sessionKey, expiresAt });
    return res.json({ ok: true, sessionId, sessionKey, expiresAt });
  });

  app.get("/api/items", (_req, res) => {
    const db = getDb();
    const items = db
      .prepare(
        "SELECT items.id, items.name, items.description, items.price, items.category_id as categoryId, categories.name as categoryName, items.game_key as gameKey, items.region as region, items.id_rules as idRules, items.provider_key as providerKey, items.delivery_type as deliveryType, items.promo_end_at as promoEndAt, items.image_url as imageUrl, items.image_file_id as imageFileId, items.is_active as isActive FROM items LEFT JOIN categories ON categories.id = items.category_id WHERE items.is_active = 1 ORDER BY items.created_at DESC"
      )
      .all() as {
      id: number;
      name: string;
      description?: string;
      price: number;
      categoryId?: number;
      categoryName?: string | null;
      gameKey: string;
      region: string;
      idRules?: string | null;
      providerKey?: string | null;
      deliveryType?: string | null;
      promoEndAt?: string | null;
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

  const imageLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    handler: (_req, res) => sendError(res, 429, "rate_limit_exceeded"),
  });

  app.get("/api/images/telegram/:fileId", imageLimiter, async (req, res) => {
    const fileId = req.params.fileId;
    if (!fileId) {
      return sendError(res, 400, "missing_file_id");
    }
    const db = getDb();
    const exists = db
      .prepare("SELECT 1 FROM items WHERE image_file_id = ? LIMIT 1")
      .get(fileId) as { 1: number } | undefined;
    if (!exists) {
      return sendError(res, 404, "file_not_found");
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
              return sendError(res, 404, "file_not_found");
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
              .on("error", () => sendError(res, 500, "file_fetch_failed"));
          } catch {
            return sendError(res, 500, "file_fetch_failed");
          }
        });
      })
      .on("error", () => sendError(res, 500, "file_fetch_failed"));
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

  app.post("/api/promos/validate", requireTelegramAuth, (req: AuthedRequest, res) => {
    const { code } = req.body as { code?: string };
    if (!code) {
      return sendError(res, 400, "missing_code");
    }
    const db = getDb();
    const promo = db
      .prepare(
        "SELECT code, type, value, expires_at as expiresAt, usage_limit as usageLimit, used_count as usedCount, is_active as isActive FROM promos WHERE code = ?"
      )
      .get(code.toUpperCase()) as
      | {
          code: string;
          type: "percent" | "fixed";
          value: number;
          expiresAt?: string | null;
          usageLimit?: number | null;
          usedCount: number;
          isActive: number;
        }
      | undefined;
    if (!promo || !promo.isActive) {
      return sendError(res, 404, "promo_not_found");
    }
    if (promo.expiresAt && Date.parse(promo.expiresAt) < Date.now()) {
      return sendError(res, 400, "promo_expired");
    }
    if (promo.usageLimit && promo.usedCount >= promo.usageLimit) {
      return sendError(res, 400, "promo_exhausted");
    }
    return res.json({
      ok: true,
      code: promo.code,
      type: promo.type,
      value: promo.value,
      expiresAt: promo.expiresAt ?? null,
    });
  });

  app.post("/api/orders", requireTelegramAuth, orderLimiter, (req: AuthedRequest, res) => {
    const { gameId, gameKey, gameNick, paymentMethod, items } = req.body as {
      gameId?: string;
      gameKey?: string;
      gameNick?: string;
      paymentMethod?: string;
      items?: { itemId: number; qty: number }[];
    };

    if (!req.user || !gameId || !gameKey || !paymentMethod || !items?.length) {
      return sendError(res, 400, "missing_fields");
    }
    const orderCooldown = checkCooldown(`orders:${req.user.telegramId}`, 2, 10 * 60 * 1000, 10 * 60 * 1000);
    if (orderCooldown.blocked) {
      markSuspected(req.user.telegramId);
      return sendError(res, 429, "cooldown_active");
    }
    if (!["DC", "Карта", "СБП 1", "СБП 2", "Картой", "dc", "card"].includes(paymentMethod)) {
      return sendError(res, 400, "invalid_payment_method");
    }
    if (!isValidGameId(gameId)) {
      return sendError(res, 400, "invalid_game_id");
    }

    const db = getDb();
    try {
      const result = db.transaction(() => {
        const user = db
          .prepare("SELECT id, is_suspected as isSuspected FROM users WHERE telegram_id = ?")
          .get(req.user!.telegramId) as { id: number; isSuspected: number } | undefined;
        if (!user) {
          return { error: { status: 404, code: "user_not_found" } };
        }
        if (user.isSuspected) {
          return { error: { status: 403, code: "user_suspected" } };
        }
        const existingPending = db
          .prepare(
            "SELECT id FROM orders WHERE user_id = ? AND status IN ('WAIT_PAYMENT', 'PROOF_SENT', 'REVIEW') LIMIT 1"
          )
          .get(user.id) as { id: number } | undefined;
        if (existingPending) {
          return { error: { status: 429, code: "active_order_exists" } };
        }

        const itemIds = items.map((item) => item.itemId);
        const dbItems = db
          .prepare(
            `SELECT id, price FROM items WHERE is_active = 1 AND id IN (${itemIds.map(() => "?").join(", ")})`
          )
          .all(...itemIds) as { id: number; price: number }[];

        if (dbItems.length !== itemIds.length) {
          return { error: { status: 400, code: "invalid_items" } };
        }

        const priceMap = new Map(dbItems.map((item) => [item.id, item.price]));
        let total = 0;
        for (const item of items) {
          if (!isValidQuantity(item.qty)) {
            return { error: { status: 400, code: "invalid_qty" } };
          }
          total += (priceMap.get(item.itemId) ?? 0) * item.qty;
        }

        const recentOrders = db
          .prepare(
            "SELECT id FROM orders WHERE user_id = ? AND game_id = ? AND total_amount = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 5"
          )
          .all(user.id, gameId, total, new Date(Date.now() - 10 * 60 * 1000).toISOString()) as { id: number }[];
        if (recentOrders.length) {
          const requested = new Map(items.map((item) => [item.itemId, item.qty]));
          for (const order of recentOrders) {
            const existingItems = db
              .prepare("SELECT item_id as itemId, qty FROM order_items WHERE order_id = ?")
              .all(order.id) as { itemId: number; qty: number }[];
            if (existingItems.length !== requested.size) {
              continue;
            }
            const matches = existingItems.every((item) => requested.get(item.itemId) === item.qty);
            if (matches) {
              return { error: { status: 409, code: "duplicate_order" } };
            }
          }
        }

        const now = nowIso();
        const result = db
          .prepare(
            "INSERT INTO orders (user_id, game_key, game_id, game_nick, nickname_snapshot, status, total_amount, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(user.id, gameKey, gameId, gameNick ?? null, gameNick ?? null, "WAIT_PAYMENT", total, paymentMethod, now, now);

        const orderId = Number(result.lastInsertRowid);
        const insertOrderItem = db.prepare(
          "INSERT INTO order_items (order_id, item_id, qty, price_snapshot) VALUES (?, ?, ?, ?)"
        );
        for (const item of items) {
          insertOrderItem.run(orderId, item.itemId, item.qty, priceMap.get(item.itemId));
        }
        recordStatus(orderId, "WAIT_PAYMENT", "api", req.user?.telegramId ?? null);

        return { orderId, totalAmount: total };
      })();

      if ("error" in result) {
        return sendError(res, result.error.status, result.error.code);
      }
      return res.json({ orderId: result.orderId, status: "WAIT_PAYMENT", totalAmount: result.totalAmount });
    } catch {
      return sendError(res, 500, "order_create_failed");
    }
  });

  app.post("/api/orders/:id/proof", requireTelegramAuth, upload.single("file"), (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const { proofFileId, proofType } = req.body as { proofFileId?: string; proofType?: string };

    if (!orderId) {
      return sendError(res, 400, "invalid_order");
    }

    if (!proofFileId && !req.file) {
      return sendError(res, 400, "missing_proof");
    }

    const db = getDb();
    try {
      const result = db.transaction(() => {
        const order = db
          .prepare(
            "SELECT orders.id, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
          )
          .get(orderId) as { id: number; telegramId: string } | undefined;
        if (!order) {
          return { error: { status: 404, code: "order_not_found" } };
        }
        if (!req.user || order.telegramId !== req.user.telegramId) {
          return { error: { status: 403, code: "forbidden" } };
        }
        const proofValue = proofFileId ?? null;
        const typeValue = proofType ?? (req.file ? req.file.mimetype : null);
        const proofPath = req.file ? req.file.path : null;
        const now = nowIso();
        const updated = db
          .prepare(
            "UPDATE orders SET proof_file_id = ?, proof_type = ?, proof_received_at = ?, proof_path = ?, status = ?, updated_at = ? WHERE id = ?"
          )
          .run(proofValue, typeValue, now, proofPath, "PROOF_SENT", now, orderId);

        if (updated.changes === 0) {
          return { error: { status: 404, code: "order_not_found" } };
        }
        recordStatus(orderId, "PROOF_SENT", "api", req.user?.telegramId ?? null);
        return { ok: true };
      })();
      if ("error" in result) {
        return sendError(res, result.error.status, result.error.code);
      }
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, "proof_upload_failed");
    }
  });

  app.post("/api/orders/:id/mark-paid", requireTelegramAuth, async (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    if (!orderId) {
      return sendError(res, 400, "invalid_order");
    }
    const db = getDb();
    try {
      const result = db.transaction(() => {
        const order = db
          .prepare(
            "SELECT orders.id, orders.proof_file_id as proofFileId, orders.proof_path as proofPath, orders.status, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
          )
          .get(orderId) as
          | { proofFileId?: string; proofPath?: string | null; status: string; telegramId: string }
          | undefined;

        if (!order) {
          return { error: { status: 404, code: "order_not_found" } };
        }
        if (!req.user || order.telegramId !== req.user.telegramId) {
          return { error: { status: 403, code: "forbidden" } };
        }
        if (!order.proofFileId && !order.proofPath) {
          return {
            error: {
              status: 400,
              code: "proof_required",
              message:
                "❗️Чтобы мы подтвердили оплату, прикрепите чек/скрин оплаты (фото или файл). После отправки чека нажмите «Я оплатил(а)» ещё раз.",
            },
          };
        }

        const now = nowIso();
        const result = db
          .prepare(
            "UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN ('WAIT_PAYMENT', 'PROOF_SENT')"
          )
          .run("REVIEW", now, orderId);
        if (result.changes === 0) {
          return { error: { status: 409, code: "invalid_status_transition" } };
        }
        db.prepare(
          "INSERT INTO order_outbox (order_id, event_type, created_at) VALUES (?, ?, ?)"
        ).run(orderId, "order_ready_for_review", now);
        recordStatus(orderId, "REVIEW", "api", req.user?.telegramId ?? null);
        return { ok: true };
      })();
      if ("error" in result) {
        return sendError(res, result.error.status, result.error.code, result.error.message);
      }
      return res.json({ ok: true, status: "REVIEW" });
    } catch {
      return sendError(res, 500, "mark_paid_failed");
    }
  });

  app.post("/api/game/check", requireTelegramAuth, gameCheckLimiter, (req: AuthedRequest, res) => {
    const { gameId } = req.body as { gameId?: string };
    if (!req.user) {
      return sendError(res, 401, "unauthorized");
    }
    const cooldown = checkCooldown(`game:${req.user.telegramId}`, 5, 60_000, 5 * 60_000);
    if (cooldown.blocked) {
      markSuspected(req.user.telegramId);
      return sendError(res, 429, "cooldown_active");
    }
    if (!gameId || !isValidGameId(gameId)) {
      return sendError(res, 400, "invalid_game_id");
    }
    const db = getDb();
    const user = db
      .prepare("SELECT is_suspected as isSuspected FROM users WHERE telegram_id = ?")
      .get(req.user.telegramId) as { isSuspected: number } | undefined;
    if (user?.isSuspected) {
      return sendError(res, 403, "user_suspected");
    }
    return res.json({ ok: true, nickname: "Ник подтвердим после проверки" });
  });

  app.post("/api/identity/resolve", requireTelegramAuth, identityLimiter, (req: AuthedRequest, res) => {
    const { gameKey, region, playerId } = req.body as {
      gameKey?: string;
      region?: string;
      playerId?: string;
    };
    if (!req.user) {
      return sendError(res, 401, "unauthorized");
    }
    if (!gameKey || !playerId) {
      return sendError(res, 400, "missing_fields");
    }
    const cacheKey = `${gameKey}:${region ?? "global"}:${playerId}`;
    cleanupIdentityCache();
    const cached = identityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ ok: true, playerId, nickname: cached.nickname, extra: {} });
    }
    const db = getDb();
    const configRow = db
      .prepare(
        "SELECT id_rules as idRules, provider_key as providerKey FROM categories WHERE game_key = ? ORDER BY sort_order ASC LIMIT 1"
      )
      .get(gameKey) as { idRules?: string | null; providerKey?: string | null } | undefined;
    const idRule = configRow?.idRules;
    let regex = /^\d{5,16}$/;
    if (idRule) {
      try {
        regex = new RegExp(idRule);
      } catch {
        return sendError(res, 500, "invalid_id_rules");
      }
    }
    if (!regex.test(playerId)) {
      return sendError(res, 400, "invalid_player_id");
    }
    const nickname = "Ник подтвердим после проверки";
    identityCache.set(cacheKey, { nickname, expiresAt: Date.now() + 5 * 60_000 });
    return res.json({ ok: true, playerId, nickname, extra: { provider: configRow?.providerKey ?? null } });
  });

  app.get("/api/orders/my", requireTelegramAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
      return sendError(res, 401, "unauthorized");
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
      return sendError(res, 400, "invalid_order");
    }
    const db = getDb();
    const order = db
      .prepare(
        "SELECT orders.id, orders.status, orders.total_amount as totalAmount, orders.game_key as gameKey, orders.game_id as gameId, COALESCE(orders.nickname_snapshot, orders.game_nick) as gameNick, orders.payment_method as paymentMethod, orders.proof_file_id as proofFileId, orders.proof_path as proofPath, orders.created_at as createdAt, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
      )
      .get(orderId) as
      | {
          id: number;
          status: string;
          totalAmount: number;
          gameKey: string;
          gameId: string;
          gameNick?: string | null;
          paymentMethod: string;
          proofFileId?: string | null;
          proofPath?: string | null;
          createdAt: string;
          telegramId: string;
        }
      | undefined;
    if (!order) {
      return sendError(res, 404, "order_not_found");
    }
    if (order.telegramId !== req.user.telegramId) {
      return sendError(res, 403, "forbidden");
    }
    const items = db
      .prepare(
        "SELECT items.name, order_items.qty, order_items.price_snapshot as priceSnapshot FROM order_items JOIN items ON items.id = order_items.item_id WHERE order_items.order_id = ?"
      )
      .all(orderId);
    return res.json({ ...order, items });
  });

  if (hasWebDist) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  if (!hasWebDist) {
    app.get("/", (_req, res) => {
      res.json({ ok: true, service: "telegram-shop-backend" });
    });
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === "unsupported_file_type") {
      return sendError(res, 400, "unsupported_file_type");
    }
    return sendError(res, 500, "internal_error");
  });

  return app;
};
const pipe = promisify(pipeline);

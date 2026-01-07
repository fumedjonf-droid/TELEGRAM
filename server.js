require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  createOrder,
  updateOrder,
  getOrder,
  listItems,
  getItem,
  upsertUser,
} = require("./storage");
const { sendAdminNotification, launchBot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

const receiptsDir = path.join(__dirname, "uploads", "receipts");
const itemsDir = path.join(__dirname, "uploads", "items");
fs.mkdirSync(receiptsDir, { recursive: true });
fs.mkdirSync(itemsDir, { recursive: true });

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, receiptsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      const orderId = req.params?.orderId || crypto.randomUUID();
      cb(null, `${orderId}${ext}`);
    },
  }),
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/verify-player", (req, res) => {
  const gameId = req.body.gameId;
  const playerId = req.body.playerId || "";

  const valid = /^\d{6,15}$/.test(playerId);
  const nickname = valid && gameId === "free-fire" ? `FF-${playerId.slice(-4)}` : "";

  console.warn("verify-player stub used", { gameId });
  res.json({ valid, nickname });
});

app.get("/api/items", (req, res) => {
  const items = listItems().filter((item) => item.isActive);
  const category = req.query.category;
  const filtered = category ? items.filter((item) => item.category === category) : items;
  res.json({ items: filtered });
});

app.get("/api/items/:id", (req, res) => {
  const item = getItem(req.params.id);
  if (!item || !item.isActive) {
    res.status(404).json({ ok: false, error: "Item not found" });
    return;
  }
  res.json({ item });
});

app.post("/api/orders", (req, res) => {
  const {
    itemId,
    playerId,
    nickname,
    paymentMethod,
  } = req.body;

  const initData = req.header("X-Telegram-InitData") || "";
  const initUser = validateTelegramInitData(initData, process.env.BOT_TOKEN);
  if (!initUser) {
    res.status(401).json({ ok: false, error: "Invalid Telegram initData" });
    return;
  }
  const telegramUserId = initUser.id || null;
  const telegramUsername = initUser.username || null;

  if (!itemId || !playerId || !paymentMethod) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const item = getItem(itemId);
  if (!item || !item.isActive) {
    res.status(400).json({ ok: false, error: "Unknown item" });
    return;
  }

  const orderId = crypto.randomUUID();
  const orderCode = `MYGA-${Math.floor(Math.random() * 900000 + 100000)}`;

  const requisites = resolveRequisites(paymentMethod);

  const order = {
    id: orderId,
    orderCode,
    telegramUserId,
    itemId: item.id,
    itemTitle: item.title,
    price: item.price,
    currency: item.currency,
    playerId,
    nickname,
    paymentMethod,
    telegramUsername,
    requisites,
    status: "WAITING_PROOF",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  createOrder(order);
  upsertUser({
    telegramUserId,
    username: telegramUsername || "",
    firstName: initUser.first_name || "",
    lastName: initUser.last_name || "",
    lastSeenAt: new Date().toISOString(),
    isBlocked: false,
  });
  console.log("Order created", { orderId, itemId: item.id, telegramUserId });

  res.json({
    id: orderId,
    code: orderCode,
    requisites,
  });
});

app.post("/api/orders/:orderId/proof", receiptUpload.single("receipt"), async (req, res) => {
  const { orderId } = req.params;
  const order = getOrder(orderId);

  if (!order) {
    res.status(404).json({ ok: false, error: "Order not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ ok: false, error: "Receipt is required" });
    return;
  }

  if (order.status === "PENDING_ADMIN_CONFIRMATION" || order.status === "APPROVED") {
    res.status(409).json({ ok: false, error: "Proof already submitted" });
    return;
  }

  const comment = req.body.comment || "";
  const cardSuffix = req.body.cardSuffix || "";
  const initData = req.body.initData || "";

  const proofUrl = `/uploads/receipts/${req.file.filename}`;
  const updated = updateOrder(orderId, {
    status: "PENDING_ADMIN_CONFIRMATION",
    receiptPath: req.file.path,
    proofUrl,
    comment,
    cardSuffix,
    initData,
    updatedAt: new Date().toISOString(),
  });

  if (updated) {
    await sendAdminNotification({ ...updated }, req.file.path);
    console.log("Proof submitted", { orderId });
  }

  res.json({ ok: true });
});

function resolveRequisites(method) {
  if (method === "dc") {
    return {
      number: process.env.PAY_DC_WALLET,
      bank: process.env.PAY_DC_NAME,
      recipient: process.env.PAY_DC_NAME,
    };
  }

  if (method === "sbp") {
    return {
      number: process.env.PAY_SBP_PHONE,
      bank: process.env.PAY_BANK_NAME,
      recipient: process.env.PAY_SBP_RECIPIENT,
    };
  }

  return {
    number: process.env.PAY_CARD_NUMBER,
    bank: process.env.PAY_BANK_NAME,
    recipient: process.env.PAY_RECIPIENT,
  };
}

function parseTelegramUser(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const user = params.get("user");
  if (!user) return null;
  try {
    return JSON.parse(user);
  } catch (error) {
    return null;
  }
}

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheck = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expectedHash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");

  if (expectedHash !== hash) return null;
  return parseTelegramUser(initData);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  launchBot();
});

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
} = require("./storage");
const { sendAdminNotification, launchBot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

const receiptsDir = path.join(__dirname, "storage", "receipts");
fs.mkdirSync(receiptsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, receiptsDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      const name = `${Date.now()}-${crypto.randomUUID()}${ext}`;
      cb(null, name);
    },
  }),
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/verify-player", (req, res) => {
  const game = req.body.game || req.body.gameId;
  const playerId = req.body.playerId || "";

  const valid = /^\d{6,15}$/.test(playerId);
  const nickname = valid ? "Player" : "";

  res.json({ ok: valid, playerId, nickname, game });
});

app.post("/api/orders", (req, res) => {
  const {
    gameId,
    productId,
    amount,
    price,
    currency,
    playerId,
    nickname,
    paymentMethod,
    telegramUserId,
  } = req.body;

  if (!gameId || !productId || !playerId || !paymentMethod) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const orderId = crypto.randomUUID();
  const orderCode = `MYGA-${Math.floor(Math.random() * 900000 + 100000)}`;

  const requisites = resolveRequisites(paymentMethod);

  const order = {
    id: orderId,
    orderCode,
    gameId,
    productId,
    amount,
    price,
    currency: currency || "RUB",
    playerId,
    nickname,
    paymentMethod,
    telegramUserId,
    requisites,
    status: "WAITING_PAYMENT",
    createdAt: new Date().toISOString(),
  };

  createOrder(order);

  res.json({
    orderId,
    orderCode,
    requisites,
  });
});

app.post("/api/orders/:orderId/proof", upload.single("receipt"), async (req, res) => {
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

  const comment = req.body.comment || "";
  const cardSuffix = req.body.cardSuffix || "";

  const updated = updateOrder(orderId, {
    status: "PENDING_ADMIN_CONFIRMATION",
    receiptPath: req.file.path,
    comment,
    cardSuffix,
    updatedAt: new Date().toISOString(),
  });

  if (updated) {
    await sendAdminNotification({ ...updated }, req.file.path);
  }

  res.json({ ok: true });
});

function resolveRequisites(method) {
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  launchBot();
});

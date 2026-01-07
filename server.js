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

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
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
  const gameId = req.body.gameId;
  const playerId = req.body.playerId || "";

  const valid = /^\d{6,15}$/.test(playerId);
  const nickname = valid && gameId === "free-fire" ? `FF-${playerId.slice(-4)}` : "";

  res.json({ valid, nickname });
});

app.post("/api/orders", (req, res) => {
  const {
    gameId,
    productId,
    playerId,
    nickname,
    paymentMethod,
  } = req.body;

  const initData = req.header("X-Telegram-InitData") || "";
  const initUser = parseTelegramUser(initData);
  const telegramUserId = initUser?.id || null;
  const telegramUsername = initUser?.username || null;

  if (!gameId || !productId || !playerId || !paymentMethod) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const product = getProduct(gameId, productId);
  if (!product) {
    res.status(400).json({ ok: false, error: "Unknown product" });
    return;
  }

  const orderId = crypto.randomUUID();
  const orderCode = `${gameId.slice(0, 2).toUpperCase()}-${Math.floor(Math.random() * 900000 + 100000)}`;

  const requisites = resolveRequisites(paymentMethod);

  const order = {
    id: orderId,
    orderCode,
    gameId,
    productId,
    title: product.title,
    price: product.price,
    currency: product.currency,
    playerId,
    nickname,
    paymentMethod,
    telegramUserId,
    telegramUsername,
    requisites,
    deliverType: product.deliverType,
    deliverPayload: product.deliverPayload,
    status: "CREATED",
    createdAt: new Date().toISOString(),
  };

  createOrder(order);
  console.log("Order created", { orderId, gameId, productId, telegramUserId });

  res.json({
    id: orderId,
    code: orderCode,
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

  if (order.status === "PENDING_ADMIN" || order.status === "PAID_CONFIRMED") {
    res.status(409).json({ ok: false, error: "Proof already submitted" });
    return;
  }

  const comment = req.body.comment || "";
  const cardSuffix = req.body.cardSuffix || "";
  const initData = req.body.initData || "";

  const updated = updateOrder(orderId, {
    status: "PENDING_ADMIN",
    receiptPath: req.file.path,
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

function getProduct(gameId, productId) {
  const game = catalog[gameId];
  if (!game) return null;
  return game.products.find((product) => product.id === productId) || null;
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

const catalog = {
  "free-fire": {
    products: [
      {
        id: "ff-100",
        title: "100 алмазов",
        price: 149,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Заказ подтвержден ✅, пополнение будет выполнено в ближайшее время.",
      },
      {
        id: "ff-310",
        title: "310 алмазов",
        price: 399,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Заказ подтвержден ✅, пополнение будет выполнено в ближайшее время.",
      },
      {
        id: "ff-520",
        title: "520 алмазов",
        price: 699,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Заказ подтвержден ✅, пополнение будет выполнено в ближайшее время.",
      },
      {
        id: "ff-1060",
        title: "1060 алмазов",
        price: 1299,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Заказ подтвержден ✅, пополнение будет выполнено в ближайшее время.",
      },
    ],
  },
  steam: {
    products: [
      {
        id: "steam-500",
        title: "Steam 500 ₽",
        price: 550,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение баланса будет выполнено.",
      },
      {
        id: "steam-1000",
        title: "Steam 1000 ₽",
        price: 1090,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение баланса будет выполнено.",
      },
      {
        id: "steam-2000",
        title: "Steam 2000 ₽",
        price: 2150,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение баланса будет выполнено.",
      },
    ],
  },
  pubg: {
    products: [
      {
        id: "pubg-60",
        title: "60 UC",
        price: 119,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение будет выполнено.",
      },
      {
        id: "pubg-325",
        title: "325 UC",
        price: 579,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение будет выполнено.",
      },
      {
        id: "pubg-660",
        title: "660 UC",
        price: 1129,
        currency: "RUB",
        deliverType: "manual",
        deliverPayload: "Оплата подтверждена ✅, пополнение будет выполнено.",
      },
    ],
  },
};

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  launchBot();
});

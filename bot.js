const { Telegraf, Markup } = require("telegraf");
const path = require("path");
const fs = require("fs");
const https = require("https");
const {
  getOrder,
  updateOrder,
  loadOrders,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  upsertUser,
  updateUser,
  loadUsers,
} = require("./storage");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

const bot = new Telegraf(BOT_TOKEN);

const addItemFlow = new Map();
const pendingPhoto = new Map();
const pendingOrderMessage = new Map();
const pendingBroadcast = new Map();

const CATEGORY_LABELS = {
  FreeFire: "Free Fire",
  PUBG: "PUBG Mobile",
  Steam: "Steam",
  Other: "Другое",
};

bot.start((ctx) => {
  const webAppUrl = getWebAppUrl();
  const user = ctx.from;
  if (ctx.chat?.type === "private" && user?.id) {
    upsertUser({
      telegramUserId: user.id,
      username: user.username || "",
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      lastSeenAt: new Date().toISOString(),
      isBlocked: false,
    });
  }

  if (!webAppUrl) {
    return ctx.reply(
      "WebApp URL не настроен. Укажите PUBLIC_BASE_URL как HTTPS ссылку на ваш сайт (например, https://your-domain.example)."
    );
  }

  if (ctx.chat?.type !== "private") {
    return ctx.reply("Откройте магазин в личном чате с ботом.");
  }

  return ctx.reply(
    "Добро пожаловать!",
    Markup.inlineKeyboard([
      Markup.button.webApp("Открыть магазин", `${webAppUrl}/`),
    ])
  );
});

bot.command("admin", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply(
    "Админ-панель",
    Markup.inlineKeyboard([
      [Markup.button.callback("📦 Товары", "ADMIN_ITEMS")],
      [Markup.button.callback("🧾 Заказы", "ADMIN_ORDERS")],
      [Markup.button.callback("📣 Рассылка", "ADMIN_BROADCAST")],
      [Markup.button.callback("⚙️ Настройки", "ADMIN_SETTINGS")],
    ])
  );
});

bot.command("help", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply(
    [
      "Доступные команды:",
      "/admin — меню админа",
      "/additem — добавить товар",
      "/items — список товаров",
      "/orders — последние заказы",
      "/msg <telegramUserId> <текст> — сообщение пользователю",
      "/broadcast <текст> — рассылка",
      "/price <itemId> <newPrice> — изменить цену",
      "/title <itemId> <text> — изменить название",
      "/desc <itemId> <text> — изменить описание",
      "/cat <itemId> <FreeFire|PUBG|Steam|Other> — изменить категорию",
      "/hide <itemId> — скрыть товар",
      "/show <itemId> — показать товар",
      "/del <itemId> — удалить товар",
      "/photo <itemId> — обновить фото товара",
      "/cancel — отменить действие",
    ].join("\n")
  );
});

bot.command("additem", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  addItemFlow.set(ctx.from.id, { step: "title", data: {} });
  await ctx.reply("Введи название товара");
});

bot.command("cancel", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  addItemFlow.delete(ctx.from.id);
  pendingPhoto.delete(ctx.from.id);
  pendingOrderMessage.delete(ctx.from.id);
  pendingBroadcast.delete(ctx.from.id);
  await ctx.reply("Действие отменено.");
});

bot.command("items", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  await sendItemsPage(ctx, 0);
});

bot.command("orders", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const orders = loadOrders().slice(-5).reverse();
  if (!orders.length) {
    await ctx.reply("Заказов пока нет.");
    return;
  }
  for (const order of orders) {
    await ctx.reply(formatOrderSummary(order));
  }
});

bot.command("msg", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const parts = ctx.message.text.split(" ").slice(1);
  const userId = Number(parts.shift());
  const text = parts.join(" ").trim();
  if (!userId || !text) {
    await ctx.reply("Использование: /msg <telegramUserId> <текст>");
    return;
  }
  await sendDirectMessage(ctx, userId, text);
});

bot.command("broadcast", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const text = ctx.message.text.replace("/broadcast", "").trim();
  if (!text) {
    await ctx.reply("Использование: /broadcast <текст>");
    return;
  }
  pendingBroadcast.set(ctx.from.id, text);
  await ctx.reply(
    `Предпросмотр:\n\n${text}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Отправить всем", `BROADCAST_CONFIRM:${ctx.from.id}`)],
      [Markup.button.callback("❌ Отмена", `BROADCAST_CANCEL:${ctx.from.id}`)],
    ])
  );
});

bot.command("price", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const [itemId, value] = ctx.message.text.split(" ").slice(1);
  const price = Number(value);
  if (!itemId || Number.isNaN(price)) {
    await ctx.reply("Использование: /price <itemId> <newPrice>");
    return;
  }
  const updated = updateItem(itemId, { price, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Цена обновлена ✅" : "Товар не найден");
});

bot.command("title", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const parts = ctx.message.text.split(" ").slice(1);
  const itemId = parts.shift();
  const title = parts.join(" ").trim();
  if (!itemId || !title) {
    await ctx.reply("Использование: /title <itemId> <text>");
    return;
  }
  const updated = updateItem(itemId, { title, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Название обновлено ✅" : "Товар не найден");
});

bot.command("desc", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const parts = ctx.message.text.split(" ").slice(1);
  const itemId = parts.shift();
  const description = parts.join(" ").trim();
  if (!itemId || !description) {
    await ctx.reply("Использование: /desc <itemId> <text>");
    return;
  }
  const updated = updateItem(itemId, { description, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Описание обновлено ✅" : "Товар не найден");
});

bot.command("cat", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const [itemId, category] = ctx.message.text.split(" ").slice(1);
  if (!itemId || !CATEGORY_LABELS[category]) {
    await ctx.reply("Использование: /cat <itemId> <FreeFire|PUBG|Steam|Other>");
    return;
  }
  const updated = updateItem(itemId, { category, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Категория обновлена ✅" : "Товар не найден");
});

bot.command("hide", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const itemId = ctx.message.text.split(" ")[1];
  if (!itemId) {
    await ctx.reply("Использование: /hide <itemId>");
    return;
  }
  const updated = updateItem(itemId, { isActive: false, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Товар скрыт ✅" : "Товар не найден");
});

bot.command("show", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const itemId = ctx.message.text.split(" ")[1];
  if (!itemId) {
    await ctx.reply("Использование: /show <itemId>");
    return;
  }
  const updated = updateItem(itemId, { isActive: true, updatedAt: new Date().toISOString() });
  await ctx.reply(updated ? "Товар показан ✅" : "Товар не найден");
});

bot.command("del", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const itemId = ctx.message.text.split(" ")[1];
  if (!itemId) {
    await ctx.reply("Использование: /del <itemId>");
    return;
  }
  await ctx.reply(
    `Удалить товар ${itemId}?`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Удалить", `ITEM_DELETE_CONFIRM:${itemId}`)],
      [Markup.button.callback("❌ Отмена", `ITEM_DELETE_CANCEL:${itemId}`)],
    ])
  );
});

bot.command("photo", async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const itemId = ctx.message.text.split(" ")[1];
  if (!itemId) {
    await ctx.reply("Использование: /photo <itemId>");
    return;
  }
  if (!getItem(itemId)) {
    await ctx.reply("Товар не найден");
    return;
  }
  pendingPhoto.set(ctx.from.id, { itemId });
  await ctx.reply("Отправьте фото товара.");
});

bot.on("text", async (ctx) => {
  if (!ensureAdmin(ctx, true)) return;
  const flow = addItemFlow.get(ctx.from.id);
  const text = ctx.message.text.trim();
  if (text.startsWith("/") && !(flow?.step === "photo" && text === "/skip")) return;
  if (flow) {
    await handleAddItemText(ctx, flow);
    return;
  }
  const pending = pendingOrderMessage.get(ctx.from.id);
  if (pending) {
    await sendOrderMessage(ctx, pending);
    return;
  }
});

bot.on("photo", async (ctx) => {
  if (!ensureAdmin(ctx, true)) return;
  const flow = addItemFlow.get(ctx.from.id);
  if (flow?.step === "photo") {
    await handleAddItemPhoto(ctx, flow);
    return;
  }
  const pending = pendingPhoto.get(ctx.from.id);
  if (pending) {
    await handleItemPhotoUpdate(ctx, pending);
  }
});

bot.on("callback_query", async (ctx) => {
  if (!ensureAdmin(ctx, true)) {
    await ctx.answerCbQuery("Нет доступа", { show_alert: true });
    return;
  }

  const data = ctx.callbackQuery?.data || "";
  if (data === "ADMIN_ITEMS") {
    await ctx.answerCbQuery();
    await sendItemsPage(ctx, 0);
    return;
  }
  if (data === "ADMIN_ORDERS") {
    await ctx.answerCbQuery();
    const orders = loadOrders().slice(-5).reverse();
    if (!orders.length) {
      await ctx.reply("Заказов пока нет.");
      return;
    }
    for (const order of orders) {
      await ctx.reply(formatOrderSummary(order));
    }
    return;
  }
  if (data === "ADMIN_BROADCAST") {
    await ctx.answerCbQuery();
    await ctx.reply("Используйте /broadcast <текст>");
    return;
  }
  if (data === "ADMIN_SETTINGS") {
    await ctx.answerCbQuery();
    await ctx.reply("Настройки скоро появятся.");
    return;
  }

  if (data.startsWith("ITEMS_PAGE:")) {
    const page = Number(data.split(":")[1]);
    await ctx.answerCbQuery();
    await sendItemsPage(ctx, page);
    return;
  }

  if (data.startsWith("ITEM_CAT:")) {
    const category = data.split(":")[1];
    const flow = addItemFlow.get(ctx.from.id);
    if (flow && CATEGORY_LABELS[category]) {
      flow.data.category = category;
      flow.step = "description";
      addItemFlow.set(ctx.from.id, flow);
      await ctx.answerCbQuery();
      await ctx.reply("Введи описание (или - чтобы пропустить)");
      return;
    }
  }

  if (data.startsWith("ITEM_TOGGLE:")) {
    const itemId = data.split(":")[1];
    const item = getItem(itemId);
    if (!item) {
      await ctx.answerCbQuery("Товар не найден", { show_alert: true });
      return;
    }
    const updated = updateItem(itemId, {
      isActive: !item.isActive,
      updatedAt: new Date().toISOString(),
    });
    await ctx.answerCbQuery(updated?.isActive ? "Товар показан" : "Товар скрыт");
    await sendItemCard(ctx, updated);
    return;
  }

  if (data.startsWith("ITEM_PHOTO:")) {
    const itemId = data.split(":")[1];
    if (!getItem(itemId)) {
      await ctx.answerCbQuery("Товар не найден", { show_alert: true });
      return;
    }
    pendingPhoto.set(ctx.from.id, { itemId });
    await ctx.answerCbQuery();
    await ctx.reply("Отправьте новое фото для товара.");
    return;
  }

  if (data.startsWith("ITEM_DELETE_CONFIRM:")) {
    const itemId = data.split(":")[1];
    const removed = deleteItem(itemId);
    await ctx.answerCbQuery(removed ? "Товар удалён" : "Товар не найден");
    return;
  }

  if (data.startsWith("ITEM_DELETE_CANCEL:")) {
    await ctx.answerCbQuery("Отменено");
    return;
  }

  if (data.startsWith("ORDER_CONFIRM:")) {
    const orderId = data.split(":")[1];
    const order = getOrder(orderId);
    if (!order) {
      await ctx.answerCbQuery("Заказ не найден", { show_alert: true });
      return;
    }
    updateOrder(orderId, { status: "APPROVED", updatedAt: new Date().toISOString() });
    await ctx.answerCbQuery("Оплата подтверждена");
    await notifyUser(order, `✅ Оплата подтверждена. Ваш заказ: ${order.itemTitle}`);
    return;
  }

  if (data.startsWith("ORDER_REJECT:")) {
    const orderId = data.split(":")[1];
    const order = getOrder(orderId);
    if (!order) {
      await ctx.answerCbQuery("Заказ не найден", { show_alert: true });
      return;
    }
    updateOrder(orderId, { status: "REJECTED", updatedAt: new Date().toISOString() });
    await ctx.answerCbQuery("Оплата отклонена");
    await notifyUser(order, "❌ Оплата не подтверждена. Свяжитесь с админом.");
    return;
  }

  if (data.startsWith("ORDER_MSG:")) {
    const orderId = data.split(":")[1];
    const order = getOrder(orderId);
    if (!order) {
      await ctx.answerCbQuery("Заказ не найден", { show_alert: true });
      return;
    }
    pendingOrderMessage.set(ctx.from.id, { orderId });
    await ctx.answerCbQuery();
    await ctx.reply(`Введи текст для клиента (заказ ${order.orderCode}).`);
    return;
  }

  if (data.startsWith("BROADCAST_CONFIRM:")) {
    const adminId = Number(data.split(":")[1]);
    const text = pendingBroadcast.get(adminId);
    if (!text) {
      await ctx.answerCbQuery("Нет текста для рассылки", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await runBroadcast(ctx, text);
    pendingBroadcast.delete(adminId);
    return;
  }

  if (data.startsWith("BROADCAST_CANCEL:")) {
    pendingBroadcast.delete(ctx.from.id);
    await ctx.answerCbQuery("Рассылка отменена");
    return;
  }
});

async function handleAddItemText(ctx, flow) {
  const text = ctx.message.text.trim();
  if (flow.step === "title") {
    flow.data.title = text;
    flow.step = "price";
    addItemFlow.set(ctx.from.id, flow);
    await ctx.reply("Введи цену (только число, пример: 25)");
    return;
  }
  if (flow.step === "price") {
    const price = Number(text);
    if (Number.isNaN(price)) {
      await ctx.reply("Цена должна быть числом.");
      return;
    }
    flow.data.price = price;
    flow.step = "category";
    addItemFlow.set(ctx.from.id, flow);
    await ctx.reply(
      "Выбери категорию",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("FreeFire", "ITEM_CAT:FreeFire"),
          Markup.button.callback("PUBG", "ITEM_CAT:PUBG"),
        ],
        [
          Markup.button.callback("Steam", "ITEM_CAT:Steam"),
          Markup.button.callback("Другое", "ITEM_CAT:Other"),
        ],
      ])
    );
    return;
  }
  if (flow.step === "description") {
    flow.data.description = text === "-" ? "" : text;
    flow.data.itemId = generateItemId();
    flow.step = "photo";
    addItemFlow.set(ctx.from.id, flow);
    await ctx.reply("Отправь фото товара (или /skip чтобы без фото)");
    return;
  }
  if (flow.step === "photo" && text === "/skip") {
    const item = finalizeItem(flow.data, null);
    addItemFlow.delete(ctx.from.id);
    await sendItemCard(ctx, item);
  }
}

async function handleAddItemPhoto(ctx, flow) {
  const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
  if (!photo) return;

  const imageUrl = await saveTelegramPhoto(photo.file_id, "uploads/items", flow.data.itemId);
  const item = finalizeItem(flow.data, imageUrl);
  addItemFlow.delete(ctx.from.id);
  await sendItemCard(ctx, item);
}

async function handleItemPhotoUpdate(ctx, pending) {
  const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
  if (!photo) return;
  const imageUrl = await saveTelegramPhoto(photo.file_id, "uploads/items", pending.itemId);
  const updated = updateItem(pending.itemId, {
    imageUrl,
    updatedAt: new Date().toISOString(),
  });
  pendingPhoto.delete(ctx.from.id);
  if (updated) {
    await sendItemCard(ctx, updated);
  }
}

function finalizeItem(data, imageUrl) {
  const now = new Date().toISOString();
  const item = {
    id: data.itemId || generateItemId(),
    title: data.title,
    price: data.price,
    currency: "TJS",
    category: data.category,
    description: data.description || "",
    imageUrl,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  createItem(item);
  console.log("Item created", { itemId: item.id, title: item.title });
  return item;
}

async function sendItemsPage(ctx, page) {
  const items = listItems();
  if (!items.length) {
    await ctx.reply("Товаров пока нет.");
    return;
  }
  const pageSize = 5;
  const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const currentPage = Math.min(Math.max(page, 0), maxPage);
  const slice = items.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  for (const item of slice) {
    await sendItemCard(ctx, item);
  }

  if (maxPage > 0) {
    await ctx.reply(
      `Страница ${currentPage + 1} из ${maxPage + 1}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("⬅️", `ITEMS_PAGE:${currentPage - 1}`),
          Markup.button.callback("➡️", `ITEMS_PAGE:${currentPage + 1}`),
        ],
      ])
    );
  }
}

async function sendItemCard(ctx, item) {
  const text = formatItemSummary(item);
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("👁 Скрыть/Показать", `ITEM_TOGGLE:${item.id}`),
      Markup.button.callback("🖼 Фото", `ITEM_PHOTO:${item.id}`),
    ],
    [Markup.button.callback("🗑 Удалить", `ITEM_DELETE_CONFIRM:${item.id}`)],
  ]);

  if (item.imageUrl) {
    const imagePath = path.join(__dirname, item.imageUrl);
    if (fs.existsSync(imagePath)) {
      await ctx.replyWithPhoto({ source: imagePath }, { caption: text, reply_markup: keyboard.reply_markup });
      return;
    }
  }
  await ctx.reply(text, keyboard);
}

function formatItemSummary(item) {
  return [
    `ID: ${item.id}`,
    `Название: ${item.title}`,
    `Цена: ${item.price} ${item.currency}`,
    `Категория: ${CATEGORY_LABELS[item.category] || item.category}`,
    `Статус: ${item.isActive ? "активен" : "скрыт"}`,
  ].join("\n");
}

function formatOrderSummary(order) {
  return [
    `Заказ: ${order.orderCode}`,
    `Товар: ${order.itemTitle}`,
    `Цена: ${order.price} ${order.currency}`,
    `Статус: ${order.status}`,
  ].join("\n");
}

async function sendOrderMessage(ctx, pending) {
  const order = getOrder(pending.orderId);
  if (!order) {
    await ctx.reply("Заказ не найден");
    pendingOrderMessage.delete(ctx.from.id);
    return;
  }
  await notifyUser(order, ctx.message.text);
  await ctx.reply("Сообщение отправлено ✅");
  pendingOrderMessage.delete(ctx.from.id);
}

async function sendDirectMessage(ctx, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text);
    await ctx.reply("Отправлено ✅");
  } catch (error) {
    await ctx.reply("Не доставлено 🚫");
    if (isUserBlockedError(error)) {
      updateUser(userId, { isBlocked: true });
    }
  }
}

async function runBroadcast(ctx, text) {
  const users = loadUsers();
  let sent = 0;
  let errors = 0;
  let blocked = 0;
  for (const user of users) {
    if (user.isBlocked) continue;
    try {
      await bot.telegram.sendMessage(user.telegramUserId, text);
      sent += 1;
    } catch (error) {
      errors += 1;
      if (isUserBlockedError(error)) {
        blocked += 1;
        updateUser(user.telegramUserId, { isBlocked: true });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  await ctx.reply(
    `Рассылка завершена.\nВсего пользователей: ${users.length}\nОтправлено: ${sent}\nОшибок: ${errors}\nЗаблокировали: ${blocked}`
  );
}

async function notifyUser(order, message) {
  if (!order.telegramUserId) return;
  try {
    await bot.telegram.sendMessage(order.telegramUserId, message);
  } catch (error) {
    if (isUserBlockedError(error)) {
      updateUser(order.telegramUserId, { isBlocked: true });
    }
    console.error("Failed to notify user", error);
  }
}

async function sendAdminNotification(order, receiptPath) {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Подтвердить", `ORDER_CONFIRM:${order.id}`),
      Markup.button.callback("❌ Отказать", `ORDER_REJECT:${order.id}`),
    ],
    [Markup.button.callback("📩 Написать клиенту", `ORDER_MSG:${order.id}`)],
  ]);

  const textLines = [
    `Заказ: ${order.orderCode}`,
    `Товар: ${order.itemTitle}`,
    `Сумма: ${order.price} ${order.currency}`,
    `Метод оплаты: ${order.paymentMethod}`,
    `Player ID: ${order.playerId} (${order.nickname || "без никнейма"})`,
    `Покупатель: ${order.telegramUserId || "неизвестно"} ${order.telegramUsername ? `(@${order.telegramUsername})` : ""}`,
    `Дата: ${order.createdAt}`,
  ];

  const caption = textLines.join("\n");

  if (receiptPath && fs.existsSync(receiptPath)) {
    await bot.telegram.sendPhoto(
      ADMIN_GROUP_ID,
      { source: path.resolve(receiptPath) },
      {
        caption,
        reply_markup: keyboard.reply_markup,
      }
    );
  } else {
    await bot.telegram.sendMessage(ADMIN_GROUP_ID, caption, { reply_markup: keyboard.reply_markup });
  }
}

function ensureAdmin(ctx, silent = false) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (String(chatId) !== String(ADMIN_GROUP_ID)) {
    if (!silent) ctx.reply("Команда доступна только в админ-группе.");
    return false;
  }
  if (!ADMIN_USER_IDS.includes(userId)) {
    if (!silent) ctx.reply("Нет доступа");
    return false;
  }
  return true;
}

function isUserBlockedError(error) {
  const description = error?.response?.description || "";
  return description.includes("blocked by the user") || description.includes("chat not found");
}

async function saveTelegramPhoto(fileId, targetDir, baseName) {
  const file = await bot.telegram.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const ext = path.extname(file.file_path) || ".jpg";
  const fullDir = path.join(__dirname, targetDir);
  fs.mkdirSync(fullDir, { recursive: true });
  const fileName = `${baseName || generateItemId()}${ext}`;
  const destPath = path.join(fullDir, fileName);
  await downloadFile(fileUrl, destPath);
  return `/${targetDir}/${fileName}`.replace(/\\/g, "/");
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (response) => {
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (error) => {
        fs.unlink(destPath, () => reject(error));
      });
  });
}

function generateItemId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "ITM-";
  for (let i = 0; i < 5; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function launchBot() {
  const webAppUrl = getWebAppUrl();
  if (!webAppUrl) {
    console.warn(
      "PUBLIC_BASE_URL is missing or invalid. Set an HTTPS URL (e.g. https://your-domain.example) before using /start."
    );
  }
  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

function getWebAppUrl() {
  if (!PUBLIC_BASE_URL) return null;
  const trimmed = PUBLIC_BASE_URL.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    return null;
  }
}

module.exports = {
  bot,
  sendAdminNotification,
  notifyUser,
  launchBot,
};

const { Telegraf, Markup } = require("telegraf");
const path = require("path");
const { getOrder, updateOrder } = require("./storage");

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

bot.start((ctx) => {
  return ctx.reply(
    "Добро пожаловать!",
    Markup.inlineKeyboard([
      Markup.button.webApp("Открыть магазин", `${PUBLIC_BASE_URL}/`),
    ])
  );
});

bot.on("callback_query", async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const isSuperAdmin = ADMIN_USER_IDS.includes(userId);
  const hasGroupAccess = await isGroupAdmin(ctx, userId, chatId);

  if (!hasGroupAccess && !isSuperAdmin) {
    await ctx.answerCbQuery("Нет прав", { show_alert: true });
    return;
  }

  const data = ctx.callbackQuery?.data || "";
  const [action, orderId] = data.split(":");
  if (!orderId) {
    await ctx.answerCbQuery("Некорректный заказ", { show_alert: true });
    return;
  }

  const order = getOrder(orderId);
  if (!order) {
    await ctx.answerCbQuery("Заказ не найден", { show_alert: true });
    return;
  }

  if (action === "confirm") {
    const confirmed = updateOrder(orderId, { status: "PAID_CONFIRMED", resolvedAt: new Date().toISOString() });
    await ctx.answerCbQuery("Оплата подтверждена");
    await deliverOrder(confirmed);
    return;
  }

  if (action === "reject") {
    updateOrder(orderId, { status: "REJECTED", resolvedAt: new Date().toISOString() });
    await ctx.answerCbQuery("Оплата отклонена");
    await notifyUser(order, "Оплата не найдена ❌");
  }
});

async function notifyUser(order, message) {
  if (!order.telegramUserId) return;
  try {
    await bot.telegram.sendMessage(order.telegramUserId, message);
  } catch (error) {
    console.error("Failed to notify user", error);
  }
}

async function deliverOrder(order) {
  if (!order) return;

  if (order.deliverType === "file" && order.deliverPayload) {
    await bot.telegram.sendDocument(order.telegramUserId, { source: path.resolve(order.deliverPayload) });
  } else if (order.deliverType === "text" && order.deliverPayload) {
    await notifyUser(order, order.deliverPayload);
  } else {
    await notifyUser(order, "Оплата подтверждена ✅ Ваш заказ передан в обработку.");
  }

  updateOrder(order.id, { status: "FULFILLED", fulfilledAt: new Date().toISOString() });
}

async function sendAdminNotification(order, receiptPath) {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Подтвердить", `confirm:${order.id}`),
      Markup.button.callback("❌ Отказать", `reject:${order.id}`),
    ],
  ]);

  const textLines = [
    `Заказ: ${order.orderCode}`,
    `Игра: ${order.gameId}`,
    `Товар: ${order.productId}`,
    `Сумма: ${order.price} ${order.currency}`,
    `Метод оплаты: ${order.paymentMethod}`,
    `Player ID: ${order.playerId} (${order.nickname || "без никнейма"})`,
    `Покупатель: ${order.telegramUserId || "неизвестно"} ${order.telegramUsername ? `(@${order.telegramUsername})` : ""}`,
    `Дата: ${order.createdAt}`,
  ];

  const caption = textLines.join("\n");

  await bot.telegram.sendPhoto(
    ADMIN_GROUP_ID,
    { source: path.resolve(receiptPath) },
    {
      caption,
      reply_markup: keyboard.reply_markup,
    }
  );
}

async function isGroupAdmin(ctx, userId, chatId) {
  if (!userId || !chatId) return false;
  if (String(chatId) !== String(ADMIN_GROUP_ID)) return false;
  try {
    const member = await ctx.telegram.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (error) {
    return false;
  }
}

function launchBot() {
  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

module.exports = {
  bot,
  sendAdminNotification,
  notifyUser,
  launchBot,
};

import { Telegraf, Markup } from "telegraf";
import { config } from "../config.js";
import { getDb, nowIso } from "../db/index.js";
import { deletePaymentSetting, getNumericSetting, getPaymentSettings, setPaymentSetting } from "../services/settings.js";
import { createItem, getOrCreateCategory, updateItem } from "../services/items.js";

const HELP_TEXT = `
/help — показать список команд (Owner/Admin/Moderator)
/listitems — список товаров (Admin/Owner)
/additem — добавить товар (Admin/Owner)
/edititem <id> — изменить товар (Admin/Owner)
/deleteitem <id> — удалить товар (Admin/Owner)
/toggleitem <id> — включить/выключить товар (Admin/Owner)
/orders — последние заказы (Admin/Owner/Moderator)
/order <id> — детали заказа (Admin/Owner/Moderator)
/send <telegram_id> <text> — сообщение одному пользователю (Admin/Owner)
/broadcast <text> — рассылка всем (Owner)
/payments — показать реквизиты (Admin/Owner)
/setpayment <dc|card> — установить реквизиты (Admin/Owner)
/delpayment <dc|card> — удалить реквизиты (Admin/Owner)
/grant <telegram_id> <role> — выдать доступ (Owner)
/revoke <telegram_id> — забрать доступ (Owner)
/admins — список админов/ролей (Owner)
`.trim();

type Role = "owner" | "admin" | "moderator";
type PendingPayment = { type: "dc" | "card" };
type PendingItem = {
  mode: "create" | "edit";
  id?: number;
  step: "name" | "price" | "description" | "category" | "photo";
  name?: string;
  price?: number;
  description?: string;
  category?: string;
  imageFileId?: string | null;
};

const pendingPayments = new Map<string, PendingPayment>();
const pendingItems = new Map<string, PendingItem>();

const requireAdminChat = async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.chat) {
    return;
  }
  const chatId = String(ctx.chat.id);
  const isOwnerPrivate = ctx.chat.type === "private" && String(ctx.from?.id) === config.OWNER_TELEGRAM_ID;
  if (chatId !== config.ADMIN_GROUP_ID && !isOwnerPrivate) {
    await ctx.reply("❌ Команда доступна только в админ-группе.");
    return;
  }
  await next();
};

const requireRole = (roles: Role[]) => async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.from) {
    return;
  }
  const db = getDb();
  const admin = db
    .prepare("SELECT role FROM admins WHERE telegram_id = ?")
    .get(String(ctx.from.id)) as { role: Role } | undefined;
  const role = admin?.role;
  if (!role || !roles.includes(role)) {
    await ctx.reply("❌ Нет прав.");
    return;
  }
  await next();
};

export const createBot = () => {
  const bot = new Telegraf(config.BOT_TOKEN);

  bot.start(async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Пожалуйста, откройте бот в личных сообщениях.");
      return;
    }
    const db = getDb();
    const now = nowIso();
    const telegramId = String(ctx.from.id);
    const existing = db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(telegramId) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE users SET last_seen_at = ?, username = ?, first_name = ?, updated_at = ? WHERE id = ?")
        .run(now, ctx.from.username ?? null, ctx.from.first_name ?? null, now, existing.id);
    } else {
      db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, created_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(telegramId, ctx.from.username ?? null, ctx.from.first_name ?? null, now, now, now);
    }

    await ctx.reply(
      "Откройте магазин:",
      Markup.inlineKeyboard([Markup.button.webApp("Открыть магазин", config.APP_URL)])
    );
  });

  bot.command("help", requireAdminChat, async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("orders", requireAdminChat, requireRole(["owner", "admin", "moderator"]), async (ctx) => {
    const db = getDb();
    const orders = db
      .prepare(
        "SELECT orders.id, orders.status, orders.total_amount as totalAmount, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id ORDER BY orders.created_at DESC LIMIT 10"
      )
      .all() as { id: number; status: string; totalAmount: number; telegramId: string }[];
    if (!orders.length) {
      await ctx.reply("Нет заказов.");
      return;
    }
    const message = orders
      .map(
        (order) => `#${order.id} • ${order.status} • ${order.totalAmount} • user ${order.telegramId}`
      )
      .join("\n");
    await ctx.reply(message);
  });

  bot.command("order", requireAdminChat, requireRole(["owner", "admin", "moderator"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /order <id>");
      return;
    }
    const db = getDb();
    const order = db
      .prepare(
        `SELECT orders.id, orders.status, orders.total_amount as totalAmount, orders.game_id as gameId, orders.game_nick as gameNick,
        orders.payment_method as paymentMethod, orders.proof_file_id as proofFileId, orders.proof_type as proofType,
        orders.created_at as createdAt, users.telegram_id as telegramId, users.username as username
        FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`
      )
      .get(id) as
      | {
          id: number;
          status: string;
          totalAmount: number;
          gameId: string;
          gameNick?: string | null;
          paymentMethod: string;
          proofFileId?: string | null;
          proofType?: string | null;
          createdAt: string;
          telegramId: string;
          username?: string | null;
        }
      | undefined;
    if (!order) {
      await ctx.reply("Заказ не найден.");
      return;
    }
    const items = db
      .prepare(
        `SELECT items.name, order_items.qty, order_items.price_snapshot as priceSnapshot
         FROM order_items JOIN items ON items.id = order_items.item_id WHERE order_items.order_id = ?`
      )
      .all(id) as { name: string; qty: number; priceSnapshot: number }[];
    const itemLines = items.map((item) => `${item.name} × ${item.qty} (${item.priceSnapshot})`).join("\n");
    const userLabel = order.username ? `@${order.username}` : order.telegramId;
    const message = [
      `🧾 Заказ #${order.id}`,
      `👤 ${userLabel}`,
      `🎮 ID: ${order.gameId}`,
      order.gameNick ? `🧑 Ник: ${order.gameNick}` : null,
      `💰 Сумма: ${order.totalAmount}`,
      `💳 Оплата: ${order.paymentMethod}`,
      `📎 Чек: ${order.proofFileId ? "есть" : "нет"}`,
      `Статус: ${order.status}`,
      `Создан: ${order.createdAt}`,
      `Товары:\n${itemLines}`,
    ].filter(Boolean).join("\n");
    await ctx.reply(message);
    if (order.proofFileId) {
      if (order.proofType?.startsWith("image/")) {
        await ctx.replyWithPhoto(order.proofFileId);
      } else {
        await ctx.replyWithDocument(order.proofFileId);
      }
    }
  });

  bot.command("listitems", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const db = getDb();
    const items = db
      .prepare(
        "SELECT id, name, price, is_active as isActive FROM items ORDER BY created_at DESC LIMIT 50"
      )
      .all() as { id: number; name: string; price: number; isActive: number }[];
    if (!items.length) {
      await ctx.reply("Список товаров пуст.");
      return;
    }
    const message = items
      .map((item) => `#${item.id} • ${item.name} • ${item.price} • ${item.isActive ? "on" : "off"}`)
      .join("\n");
    await ctx.reply(message);
  });

  bot.command("additem", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    pendingItems.set(String(ctx.from.id), { mode: "create", step: "name" });
    await ctx.reply("Введите название товара.");
  });

  bot.command("edititem", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /edititem <id>");
      return;
    }
    const db = getDb();
    const item = db
      .prepare("SELECT id, name, price, description, category_id as categoryId, image_file_id as imageFileId FROM items WHERE id = ?")
      .get(id) as { id: number; name: string; price: number; description: string; categoryId?: number | null; imageFileId?: string | null } | undefined;
    if (!item) {
      await ctx.reply("Товар не найден.");
      return;
    }
    pendingItems.set(String(ctx.from.id), {
      mode: "edit",
      id,
      step: "name",
      name: item.name,
      price: item.price,
      description: item.description,
    });
    await ctx.reply(`Введите новое название товара (#${id}).`);
  });

  bot.command("deleteitem", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /deleteitem <id>");
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    await ctx.reply(`✅ Товар #${id} удалён.`);
  });

  bot.command("toggleitem", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /toggleitem <id>");
      return;
    }
    const db = getDb();
    const item = db
      .prepare("SELECT is_active as isActive FROM items WHERE id = ?")
      .get(id) as { isActive: number } | undefined;
    if (!item) {
      await ctx.reply("Товар не найден.");
      return;
    }
    const next = item.isActive ? 0 : 1;
    db.prepare("UPDATE items SET is_active = ?, updated_at = ? WHERE id = ?").run(next, nowIso(), id);
    await ctx.reply(`✅ Товар #${id} теперь ${next ? "включён" : "выключен"}.`);
  });

  bot.command("grant", requireAdminChat, requireRole(["owner"]), async (ctx) => {
    const [_, telegramId, role] = ctx.message.text.split(" ");
    if (!telegramId || !role || !["admin", "moderator"].includes(role)) {
      await ctx.reply("Использование: /grant <telegram_id> <admin|moderator>");
      return;
    }
    const db = getDb();
    db.prepare(
      "INSERT INTO admins (telegram_id, role, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET role = excluded.role"
    ).run(telegramId, role, String(ctx.from.id), nowIso());
    await ctx.reply(`✅ Роль ${role} назначена ${telegramId}.`);
  });

  bot.command("revoke", requireAdminChat, requireRole(["owner"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /revoke <telegram_id>");
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM admins WHERE telegram_id = ?").run(telegramId);
    await ctx.reply(`✅ Доступ отозван у ${telegramId}.`);
  });

  bot.command("admins", requireAdminChat, requireRole(["owner"]), async (ctx) => {
    const db = getDb();
    const admins = db
      .prepare("SELECT telegram_id as telegramId, role FROM admins ORDER BY role DESC")
      .all() as { telegramId: string; role: Role }[];
    if (!admins.length) {
      await ctx.reply("Список админов пуст.");
      return;
    }
    const list = admins.map((admin) => `${admin.telegramId} — ${admin.role}`).join("\n");
    await ctx.reply(list);
  });

  bot.command("send", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, telegramId, ...rest] = ctx.message.text.split(" ");
    const text = rest.join(" ").trim();
    if (!telegramId || !text) {
      await ctx.reply("Использование: /send <telegram_id> <text>");
      return;
    }
    try {
      await bot.telegram.sendMessage(telegramId, text);
      await ctx.reply("✅ Сообщение отправлено.");
    } catch {
      await ctx.reply("❌ Не удалось отправить сообщение.");
    }
  });

  bot.command("broadcast", requireAdminChat, requireRole(["owner"]), async (ctx) => {
    const text = ctx.message.text.replace("/broadcast", "").trim();
    if (!text) {
      await ctx.reply("Использование: /broadcast <text>");
      return;
    }
    const db = getDb();
    const users = db
      .prepare(
        "SELECT telegram_id as telegramId FROM users WHERE (is_blocked IS NULL OR is_blocked = 0) LIMIT 5000"
      )
      .all() as { telegramId: string }[];
    let sent = 0;
    let failed = 0;
    let blocked = 0;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const batch = 20;
    const pauseMs = 1200;
    for (let i = 0; i < users.length; i += 1) {
      const user = users[i];
      try {
        await bot.telegram.sendMessage(user.telegramId, text);
        sent += 1;
      } catch (error: any) {
        failed += 1;
        const msg = String(error?.response?.description || error?.message || "").toLowerCase();
        if (msg.includes("blocked by the user") || msg.includes("chat not found")) {
          blocked += 1;
          db.prepare("UPDATE users SET is_blocked = 1, updated_at = ? WHERE telegram_id = ?").run(
            nowIso(),
            user.telegramId
          );
        }
      }
      if ((i + 1) % batch === 0) {
        await sleep(pauseMs);
      }
    }
    await ctx.reply(`✅ Рассылка завершена. Успешно: ${sent}, ошибок: ${failed}, заблокировали: ${blocked}.`);
  });

  bot.command("payments", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const payments = getPaymentSettings();
    const message = [
      `DC: ${payments.dc ?? "не задано"}`,
      `Card: ${payments.card ?? "не задано"}`,
    ].join("\n");
    await ctx.reply(message);
  });

  bot.command("setpayment", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, type] = ctx.message.text.split(" ");
    if (!type || !["dc", "card"].includes(type)) {
      await ctx.reply("Использование: /setpayment <dc|card>");
      return;
    }
    pendingPayments.set(String(ctx.from.id), { type: type as PendingPayment["type"] });
    await ctx.reply(`Отправьте текст реквизитов для ${type}.`);
  });

  bot.command("delpayment", requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const [_, type] = ctx.message.text.split(" ");
    if (!type || !["dc", "card"].includes(type)) {
      await ctx.reply("Использование: /delpayment <dc|card>");
      return;
    }
    deletePaymentSetting(type as PendingPayment["type"], String(ctx.from.id));
    await ctx.reply(`✅ Реквизиты ${type} удалены.`);
  });

  bot.on(["text", "photo"], requireAdminChat, requireRole(["owner", "admin"]), async (ctx) => {
    const incomingText = ctx.message.text?.trim();
    if (incomingText?.startsWith("/")) {
      return;
    }
    const pending = pendingPayments.get(String(ctx.from.id));
    if (pending) {
      const text = incomingText;
      if (!text) {
        await ctx.reply("Отправьте текст реквизитов.");
        return;
      }
      setPaymentSetting(pending.type, text, String(ctx.from.id));
      pendingPayments.delete(String(ctx.from.id));
      await ctx.reply(`✅ Реквизиты ${pending.type} обновлены.`);
      return;
    }

    const pendingItem = pendingItems.get(String(ctx.from.id));
    if (!pendingItem) {
      return;
    }

    if (pendingItem.step === "photo") {
      const photos = ctx.message.photo;
      if (!photos?.length) {
        await ctx.reply("Отправьте фото товара.");
        return;
      }
      pendingItem.imageFileId = photos[photos.length - 1].file_id;
      const categoryId = pendingItem.category ? getOrCreateCategory(pendingItem.category) : null;
      if (pendingItem.mode === "create") {
        createItem({
          name: pendingItem.name!,
          price: pendingItem.price!,
          description: pendingItem.description ?? "",
          categoryId,
          imageFileId: pendingItem.imageFileId ?? null,
        });
        pendingItems.delete(String(ctx.from.id));
        await ctx.reply("✅ Товар добавлен.");
      } else if (pendingItem.id) {
        updateItem(pendingItem.id, {
          name: pendingItem.name!,
          price: pendingItem.price!,
          description: pendingItem.description ?? "",
          categoryId,
          imageFileId: pendingItem.imageFileId ?? null,
        });
        pendingItems.delete(String(ctx.from.id));
        await ctx.reply("✅ Товар обновлён.");
      }
      return;
    }

    const text = incomingText;
    if (!text) {
      await ctx.reply("Отправьте текст.");
      return;
    }

    if (pendingItem.step === "name") {
      pendingItem.name = text;
      pendingItem.step = "price";
      await ctx.reply("Введите цену (число).");
      return;
    }

    if (pendingItem.step === "price") {
      const price = Number(text);
      if (!Number.isFinite(price) || price <= 0) {
        await ctx.reply("Цена должна быть числом.");
        return;
      }
      pendingItem.price = price;
      pendingItem.step = "description";
      await ctx.reply("Введите описание товара.");
      return;
    }

    if (pendingItem.step === "description") {
      pendingItem.description = text;
      pendingItem.step = "category";
      await ctx.reply("Введите категорию товара.");
      return;
    }

    if (pendingItem.step === "category") {
      pendingItem.category = text;
      pendingItem.step = "photo";
      await ctx.reply("Отправьте фото товара.");
    }
  });

  return bot;
};

export const sendOrderToAdminGroup = async (bot: Telegraf, orderId: number) => {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT orders.id, orders.game_id as gameId, orders.status, orders.total_amount as totalAmount,
      orders.payment_method as paymentMethod, orders.proof_file_id as proofFileId, orders.proof_path as proofPath,
      orders.proof_type as proofType,
      orders.created_at as createdAt, users.telegram_id as telegramId, users.username as username
      FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`
    )
    .get(orderId) as
    | {
        id: number;
        gameId: string;
        status: string;
        totalAmount: number;
        paymentMethod: string;
        proofFileId?: string | null;
        proofPath?: string | null;
        proofType?: string | null;
        createdAt: string;
        telegramId: string;
        username?: string | null;
      }
    | undefined;

  if (!order) {
    return;
  }

  const items = db
    .prepare(
      `SELECT items.name, order_items.qty, order_items.price_snapshot as priceSnapshot
       FROM order_items JOIN items ON items.id = order_items.item_id WHERE order_items.order_id = ?`
    )
    .all(orderId) as { name: string; qty: number; priceSnapshot: number }[];

  const itemLines = items.map((item) => `${item.name} × ${item.qty} (${item.priceSnapshot})`).join("\n");
  const userLabel = order.username ? `@${order.username}` : order.telegramId;
  const message = [
    `🧾 Заказ #${order.id}`,
    `👤 ${userLabel}`,
    `🎮 ID: ${order.gameId}`,
    `💰 Сумма: ${order.totalAmount}`,
    `💳 Оплата: ${order.paymentMethod}`,
    `📎 Чек: ${order.proofFileId || order.proofPath ? "есть" : "нет"}`,
    `Статус: ${order.status}`,
    `Создан: ${order.createdAt}`,
    `Товары:\n${itemLines}`,
  ].join("\n");

  const buttons = [
    [
      Markup.button.callback("✅ Подтвердить оплату", `order:approve:${order.id}`),
      Markup.button.callback("❌ Отклонить", `order:reject:${order.id}`),
    ],
    [
      Markup.button.callback("💬 Запросить чек", `order:request_proof:${order.id}`),
      Markup.button.callback("📦 Выполнено", `order:complete:${order.id}`),
    ],
  ];

  await bot.telegram.sendMessage(config.ADMIN_GROUP_ID, message, Markup.inlineKeyboard(buttons));

  if (order.proofFileId) {
    if (order.proofType?.startsWith("image/")) {
      await bot.telegram.sendPhoto(config.ADMIN_GROUP_ID, order.proofFileId);
    } else {
      await bot.telegram.sendDocument(config.ADMIN_GROUP_ID, order.proofFileId);
    }
  } else if (order.proofPath) {
    await bot.telegram.sendDocument(config.ADMIN_GROUP_ID, { source: order.proofPath });
  }
};

export const registerOrderActions = (bot: Telegraf) => {
  const handleStatusChange = async (
    ctx: any,
    status: string,
    action: string,
    expectedStatus: string,
    note?: string
  ) => {
    if (!ctx.from) {
      return;
    }
    const db = getDb();
    const admin = db
      .prepare("SELECT role FROM admins WHERE telegram_id = ?")
      .get(String(ctx.from.id)) as { role: Role } | undefined;
    if (!admin) {
      await ctx.answerCbQuery("Нет прав.");
      return;
    }
    if (admin.role === "moderator" && status !== "awaiting_proof") {
      await ctx.answerCbQuery("Нет прав.");
      return;
    }
    if (String(ctx.chat?.id) !== config.ADMIN_GROUP_ID) {
      await ctx.answerCbQuery("Недоступно вне админ-группы.");
      return;
    }
    const orderId = Number(ctx.match?.[1]);
    if (!orderId) {
      await ctx.answerCbQuery("Неверный заказ.");
      return;
    }
    const now = nowIso();
    const result = db
      .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .run(status, now, orderId, expectedStatus);
    if (result.changes === 0) {
      await ctx.reply("⚠️ Невозможно выполнить действие: статус заказа изменился или заказ не найден.");
      return;
    }
    db.prepare(
      "INSERT INTO admin_actions (order_id, admin_telegram_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(orderId, String(ctx.from.id), action, note ?? null, now);

    const orderUser = db
      .prepare(
        "SELECT users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
      )
      .get(orderId) as { telegramId: string } | undefined;
    if (orderUser) {
      await bot.telegram.sendMessage(orderUser.telegramId, `Заказ #${orderId} обновлён: ${status}.`);
    }
    await ctx.answerCbQuery("Статус обновлён.");
  };

  bot.action(/order:approve:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "approved", "approve", "paid_review");
  });
  bot.action(/order:reject:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "rejected", "reject", "paid_review");
  });
  bot.action(/order:request_proof:(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match?.[1]);
    if (!orderId) {
      await ctx.answerCbQuery("Неверный заказ.");
      return;
    }
    await handleStatusChange(
      ctx,
      "awaiting_proof",
      "request_proof",
      "pending",
      `📎 Пришлите, пожалуйста, чек/скрин оплаты по заказу №${orderId}. Без чека мы не сможем подтвердить оплату.`
    );
  });
  bot.action(/order:complete:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "completed", "complete", "approved");
  });
};

export const startOutboxWorker = (bot: Telegraf) => {
  let running = false;
  const processOutbox = async () => {
    const db = getDb();
    const events = db
      .prepare(
        "SELECT id, order_id as orderId FROM order_outbox WHERE event_type = 'order_ready_for_review' AND processed_at IS NULL LIMIT 5"
      )
      .all() as { id: number; orderId: number }[];
    if (!events.length) {
      return;
    }
    for (const event of events) {
      await sendOrderToAdminGroup(bot, event.orderId);
      db.prepare("UPDATE order_outbox SET processed_at = ? WHERE id = ?").run(nowIso(), event.id);
    }
  };

  const processAutoActions = async () => {
    const remindMinutes = getNumericSetting("auto_remind_minutes", 15);
    const cancelMinutes = getNumericSetting("auto_cancel_minutes", 60);
    const db = getDb();
    const now = Date.now();
    const orders = db
      .prepare(
        "SELECT orders.id, orders.created_at as createdAt, orders.reminder_sent_at as reminderSentAt, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.status IN ('pending', 'awaiting_proof')"
      )
      .all() as { id: number; createdAt: string; reminderSentAt?: string | null; telegramId: string }[];

    for (const order of orders) {
      const createdAt = Date.parse(order.createdAt);
      const diffMinutes = (now - createdAt) / 60000;
      if (diffMinutes >= cancelMinutes) {
        db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(
          "canceled",
          nowIso(),
          order.id
        );
        await bot.telegram.sendMessage(
          order.telegramId,
          `Заказ #${order.id} отменён из-за отсутствия чека.`
        );
      } else if (diffMinutes >= remindMinutes && !order.reminderSentAt) {
        await bot.telegram.sendMessage(
          order.telegramId,
          `Напоминание: отправьте чек по заказу #${order.id}, чтобы продолжить обработку.`
        );
        db.prepare("UPDATE orders SET reminder_sent_at = ? WHERE id = ?").run(nowIso(), order.id);
      }
    }
  };

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await processOutbox();
      await processAutoActions();
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    tick().catch(() => null);
  }, 30_000);
};

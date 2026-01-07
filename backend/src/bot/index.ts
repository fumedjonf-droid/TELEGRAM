import { Telegraf, Markup } from "telegraf";
import { config } from "../config.js";
import { getDb, nowIso } from "../db/index.js";

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
/grant <telegram_id> <role> — выдать доступ (Owner)
/revoke <telegram_id> — забрать доступ (Owner)
/admins — список админов/ролей (Owner)
`.trim();

type Role = "owner" | "admin" | "moderator";

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
    const db = getDb();
    const now = nowIso();
    const telegramId = String(ctx.from.id);
    const existing = db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(telegramId) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE users SET last_seen_at = ?, username = ?, first_name = ? WHERE id = ?")
        .run(now, ctx.from.username ?? null, ctx.from.first_name ?? null, existing.id);
    } else {
      db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
      ).run(telegramId, ctx.from.username ?? null, ctx.from.first_name ?? null, now, now);
    }

    await ctx.reply(
      "Откройте магазин:",
      Markup.inlineKeyboard([
        Markup.button.webApp("Открыть магазин", config.APP_URL),
      ])
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
    `Заказ #${order.id}`,
    `Пользователь: ${userLabel}`,
    `Игровой ID: ${order.gameId}`,
    `Сумма: ${order.totalAmount}`,
    `Метод оплаты: ${order.paymentMethod}`,
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
  const handleStatusChange = async (ctx: any, status: string, action: string, note?: string) => {
    if (!ctx.from) {
      return;
    }
    const db = getDb();
    const admin = db
      .prepare("SELECT role FROM admins WHERE telegram_id = ?")
      .get(String(ctx.from.id)) as { role: Role } | undefined;
    if (!admin || (status === "approved" || status === "rejected") && admin.role === "moderator") {
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
    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now, orderId);
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
    await handleStatusChange(ctx, "approved", "approve");
  });
  bot.action(/order:reject:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "rejected", "reject");
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
      `📎 Пришлите, пожалуйста, чек/скрин оплаты по заказу №${orderId}. Без чека мы не сможем подтвердить оплату.`
    );
  });
  bot.action(/order:complete:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "completed", "complete");
  });
};

import { Telegraf, Markup } from "telegraf";
import { config } from "../config.js";
import { getDb, nowIso } from "../db/index.js";
import { deletePaymentSetting, getNumericSetting, getPaymentSettings, setPaymentSetting } from "../services/settings.js";
import { createItem, getOrCreateCategory, updateItem } from "../services/items.js";

const HELP_TEXT = `
/help — показать список команд (Owner/Admin/Moderator/Support)
/panel — админ-панель кнопками (Owner/Admin/Moderator/Support)
/listitems — список товаров (Admin/Owner)
/additem — добавить товар (Admin/Owner)
/edititem <id> — изменить товар (Admin/Owner)
/deleteitem <id> — удалить товар (Admin/Owner)
/toggleitem <id> — включить/выключить товар (Admin/Owner)
/orders — последние заказы (Admin/Owner/Moderator/Support)
/order <id> — детали заказа (Admin/Owner/Moderator/Support)
/send <telegram_id> <text> — сообщение одному пользователю (Admin/Owner/Support)
/broadcast <text> — рассылка всем (Owner)
/payments — показать реквизиты (Admin/Owner)
/setpayment <dc|card> — установить реквизиты (Admin/Owner)
/delpayment <dc|card> — удалить реквизиты (Admin/Owner)
/grant <telegram_id> <role> — выдать доступ (Owner)
/revoke <telegram_id> — забрать доступ (Owner)
/admins — список админов/ролей (Owner)
/suspicious <telegram_id> — пометить пользователя (Owner)
/unsuspicious <telegram_id> — снять подозрение (Owner)
/suspicion <telegram_id> — статус подозрения (Owner)
`.trim();

type Role = "owner" | "admin" | "moderator" | "support";
type Permission =
  | "view_orders"
  | "confirm"
  | "refund"
  | "edit_price"
  | "broadcast"
  | "manage_items"
  | "manage_admins"
  | "manage_payments"
  | "send_message";
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
const pendingConfirmations = new Map<string, { orderId: number; expiresAt: number }>();
const pendingAdminInputs = new Map<string, { action: string }>();

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    "view_orders",
    "confirm",
    "refund",
    "edit_price",
    "broadcast",
    "manage_items",
    "manage_admins",
    "manage_payments",
    "send_message",
  ],
  admin: ["view_orders", "confirm", "refund", "edit_price", "manage_items", "manage_payments", "send_message"],
  moderator: ["view_orders", "confirm"],
  support: ["view_orders", "send_message"],
};

const logAdminAction = (adminId: string, action: string, note?: string | null, orderId?: number | null) => {
  const db = getDb();
  db.prepare(
    "INSERT INTO admin_actions (order_id, admin_telegram_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(orderId ?? null, adminId, action, note ?? null, nowIso());
};

const requireAdminChat = async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.chat) {
    return;
  }
  const chatId = String(ctx.chat.id);
  if (chatId !== config.ADMIN_GROUP_ID) {
    await ctx.reply("❌ Команда доступна только в админ-группе.");
    return;
  }
  await next();
};

const requireAdminChatSilent = async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.chat) {
    return;
  }
  const chatId = String(ctx.chat.id);
  if (chatId !== config.ADMIN_GROUP_ID) {
    return;
  }
  await next();
};

const requirePermission = (permissions: Permission[]) => async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.from) {
    return;
  }
  const db = getDb();
  const admin = db
    .prepare("SELECT role FROM admins WHERE telegram_id = ?")
    .get(String(ctx.from.id)) as { role: Role } | undefined;
  const role = admin?.role;
  if (!role) {
    await ctx.reply("❌ Нет прав.");
    return;
  }
  const allowed = permissions.some((permission) => rolePermissions[role]?.includes(permission));
  if (!allowed) {
    await ctx.reply("❌ Нет прав.");
    return;
  }
  await next();
};

const ensurePermission = async (ctx: any, permissions: Permission[]) => {
  if (!ctx.from) {
    return false;
  }
  const db = getDb();
  const admin = db
    .prepare("SELECT role FROM admins WHERE telegram_id = ?")
    .get(String(ctx.from.id)) as { role: Role } | undefined;
  const role = admin?.role;
  if (!role) {
    await ctx.answerCbQuery("Нет прав.");
    return false;
  }
  const allowed = permissions.some((permission) => rolePermissions[role]?.includes(permission));
  if (!allowed) {
    await ctx.answerCbQuery("Нет прав.");
    return false;
  }
  return true;
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

  bot.command(
    "panel",
    requireAdminChat,
    requirePermission([
      "view_orders",
      "send_message",
      "manage_items",
      "manage_admins",
      "manage_payments",
      "broadcast",
    ]),
    async (ctx) => {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🧾 Заказы", "panel:orders")],
        [Markup.button.callback("📦 Товары", "panel:products"), Markup.button.callback("🗂 Категории", "panel:categories")],
        [Markup.button.callback("💸 Цены/скидки", "panel:prices")],
        [Markup.button.callback("👥 Пользователи", "panel:users")],
        [Markup.button.callback("📣 Рассылки", "panel:broadcasts")],
        [Markup.button.callback("⚙️ Настройки", "panel:settings")],
        [Markup.button.callback("💬 Ответы поддержки", "panel:templates")],
      ]);
      await ctx.reply("Admin Center", keyboard);
    }
  );

  bot.action("panel:products", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    await ctx.reply(
      "Товары:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Список", "panel:products:list")],
        [Markup.button.callback("Добавить", "panel:products:add")],
        [Markup.button.callback("Изменить", "panel:products:edit")],
        [Markup.button.callback("Вкл/Выкл", "panel:products:toggle")],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action("panel:categories", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    await ctx.reply(
      "Категории:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Список", "panel:categories:list")],
        [Markup.button.callback("Добавить", "panel:categories:add")],
        [Markup.button.callback("Переименовать", "panel:categories:edit")],
        [Markup.button.callback("Вкл/Выкл", "panel:categories:toggle")],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action("panel:orders", async (ctx) => {
    if (!(await ensurePermission(ctx, ["view_orders"]))) {
      return;
    }
    await ctx.reply(
      "Заказы:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Последние", "panel:orders:recent")],
        [Markup.button.callback("По order_id", "panel:orders:by_id")],
        [Markup.button.callback("По telegram_id", "panel:orders:by_user")],
        [Markup.button.callback("По game_id", "panel:orders:by_game")],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action("panel:templates", async (ctx) => {
    if (!(await ensurePermission(ctx, ["send_message"]))) {
      return;
    }
    await ctx.reply(
      "Шаблоны ответов:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Оплата не найдена", "panel:template:not_found")],
        [Markup.button.callback("Проверка заняла время", "panel:template:slow")],
        [Markup.button.callback("Выполнено", "panel:template:done")],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action("panel:prices", async (ctx) => {
    if (!(await ensurePermission(ctx, ["edit_price"]))) {
      return;
    }
    await ctx.reply("Раздел цен/скидок в разработке. Используйте /edititem <id>.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:users", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_admins"]))) {
      return;
    }
    await ctx.reply("Раздел пользователей в разработке. Используйте /suspicious или /suspicion.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:broadcasts", async (ctx) => {
    if (!(await ensurePermission(ctx, ["broadcast"]))) {
      return;
    }
    await ctx.reply("Рассылки доступны командой /broadcast <text>.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:settings", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_payments"]))) {
      return;
    }
    await ctx.reply("Настройки доступны командами /payments и /setpayment.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:products:list", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    await ctx.answerCbQuery();
    return bot.handleUpdate({ ...ctx.update, message: { ...ctx.update.callback_query?.message, text: "/listitems" } } as any);
  });

  bot.action("panel:products:add", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingItems.set(String(ctx.from.id), { mode: "create", step: "name" });
    await ctx.reply("Введите название товара.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:products:edit", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items", "edit_price"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "edit_item" });
    await ctx.reply("Отправьте ID товара для редактирования.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:products:toggle", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "toggle_item" });
    await ctx.reply("Отправьте ID товара для включения/выключения.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:categories:list", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    const db = getDb();
    const categories = db
      .prepare("SELECT id, name, is_active as isActive FROM categories ORDER BY sort_order ASC")
      .all() as { id: number; name: string; isActive: number }[];
    if (!categories.length) {
      await ctx.reply("Категорий нет.");
    } else {
      await ctx.reply(categories.map((c) => `#${c.id} • ${c.name} • ${c.isActive ? "on" : "off"}`).join("\n"));
    }
    await ctx.answerCbQuery();
  });

  bot.action("panel:categories:add", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "add_category" });
    await ctx.reply("Отправьте название новой категории.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:categories:edit", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "edit_category" });
    await ctx.reply("Отправьте: <id> <новое название>");
    await ctx.answerCbQuery();
  });

  bot.action("panel:categories:toggle", async (ctx) => {
    if (!(await ensurePermission(ctx, ["manage_items"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "toggle_category" });
    await ctx.reply("Отправьте ID категории для включения/выключения.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:orders:recent", async (ctx) => {
    if (!(await ensurePermission(ctx, ["view_orders"]))) {
      return;
    }
    await ctx.answerCbQuery();
    return bot.handleUpdate({ ...ctx.update, message: { ...ctx.update.callback_query?.message, text: "/orders" } } as any);
  });

  bot.action("panel:orders:by_id", async (ctx) => {
    if (!(await ensurePermission(ctx, ["view_orders"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "order_by_id" });
    await ctx.reply("Отправьте номер заказа.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:orders:by_user", async (ctx) => {
    if (!(await ensurePermission(ctx, ["view_orders"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "order_by_user" });
    await ctx.reply("Отправьте telegram_id пользователя.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:orders:by_game", async (ctx) => {
    if (!(await ensurePermission(ctx, ["view_orders"]))) {
      return;
    }
    if (!ctx.from) {
      return;
    }
    pendingAdminInputs.set(String(ctx.from.id), { action: "order_by_game" });
    await ctx.reply("Отправьте игровой ID.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:template:not_found", async (ctx) => {
    if (!(await ensurePermission(ctx, ["send_message"]))) {
      return;
    }
    await ctx.reply("Оплата не найдена. Проверьте реквизиты и попробуйте ещё раз.");
    await ctx.answerCbQuery();
  });

  bot.action("panel:template:slow", async (ctx) => {
    if (!(await ensurePermission(ctx, ["send_message"]))) {
      return;
    }
    await ctx.reply("Проверка заняла больше времени, мы уже разбираемся. Спасибо за ожидание!");
    await ctx.answerCbQuery();
  });

  bot.action("panel:template:done", async (ctx) => {
    if (!(await ensurePermission(ctx, ["send_message"]))) {
      return;
    }
    await ctx.reply("Заказ выполнен. Спасибо за покупку!");
    await ctx.answerCbQuery();
  });

  bot.command("orders", requireAdminChat, requirePermission(["view_orders"]), async (ctx) => {
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

  bot.command("order", requireAdminChat, requirePermission(["view_orders"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /order <id>");
      return;
    }
    const db = getDb();
    const order = db
      .prepare(
      `SELECT orders.id, orders.status, orders.total_amount as totalAmount, orders.game_id as gameId, COALESCE(orders.nickname_snapshot, orders.game_nick) as gameNick,
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

  bot.command("listitems", requireAdminChat, requirePermission(["manage_items"]), async (ctx) => {
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
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "list_items");
    }
  });

  bot.command("additem", requireAdminChat, requirePermission(["manage_items"]), async (ctx) => {
    pendingItems.set(String(ctx.from.id), { mode: "create", step: "name" });
    await ctx.reply("Введите название товара.");
  });

  bot.command("edititem", requireAdminChat, requirePermission(["manage_items", "edit_price"]), async (ctx) => {
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

  bot.command("deleteitem", requireAdminChat, requirePermission(["manage_items"]), async (ctx) => {
    const [_, idRaw] = ctx.message.text.split(" ");
    const id = Number(idRaw);
    if (!id) {
      await ctx.reply("Использование: /deleteitem <id>");
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    await ctx.reply(`✅ Товар #${id} удалён.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "delete_item", `item:${id}`);
    }
  });

  bot.command("toggleitem", requireAdminChat, requirePermission(["manage_items"]), async (ctx) => {
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
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "toggle_item", `item:${id}:${next ? "on" : "off"}`);
    }
  });

  bot.command("grant", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
    const [_, telegramId, role] = ctx.message.text.split(" ");
    if (!telegramId || !role || !["admin", "moderator", "support"].includes(role)) {
      await ctx.reply("Использование: /grant <telegram_id> <admin|moderator|support>");
      return;
    }
    const db = getDb();
    db.prepare(
      "INSERT INTO admins (telegram_id, role, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET role = excluded.role"
    ).run(telegramId, role, String(ctx.from.id), nowIso());
    await ctx.reply(`✅ Роль ${role} назначена ${telegramId}.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "grant_admin", `${telegramId}:${role}`);
    }
  });

  bot.command("revoke", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /revoke <telegram_id>");
      return;
    }
    if (telegramId === config.OWNER_TELEGRAM_ID) {
      await ctx.reply("❌ Нельзя удалить владельца.");
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM admins WHERE telegram_id = ?").run(telegramId);
    await ctx.reply(`✅ Доступ отозван у ${telegramId}.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "revoke_admin", telegramId);
    }
  });

  bot.command("admins", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
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
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "list_admins");
    }
  });

  bot.command("suspicious", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /suspicious <telegram_id>");
      return;
    }
    const db = getDb();
    db.prepare("UPDATE users SET is_suspected = 1, updated_at = ? WHERE telegram_id = ?").run(
      nowIso(),
      telegramId
    );
    await ctx.reply(`✅ Пользователь ${telegramId} помечен как подозрительный.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "suspicious", telegramId);
    }
  });

  bot.command("unsuspicious", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /unsuspicious <telegram_id>");
      return;
    }
    const db = getDb();
    db.prepare("UPDATE users SET is_suspected = 0, updated_at = ? WHERE telegram_id = ?").run(
      nowIso(),
      telegramId
    );
    await ctx.reply(`✅ Пользователь ${telegramId} снят с подозрения.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "unsuspicious", telegramId);
    }
  });

  bot.command("suspicion", requireAdminChat, requirePermission(["manage_admins"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /suspicion <telegram_id>");
      return;
    }
    const db = getDb();
    const user = db
      .prepare("SELECT is_suspected as isSuspected FROM users WHERE telegram_id = ?")
      .get(telegramId) as { isSuspected: number } | undefined;
    if (!user) {
      await ctx.reply("Пользователь не найден.");
      return;
    }
    const history = db
      .prepare(
        "SELECT action, note, created_at as createdAt FROM admin_actions WHERE action IN ('suspicious', 'unsuspicious') AND note = ? ORDER BY created_at DESC LIMIT 5"
      )
      .all(telegramId) as { action: string; note?: string | null; createdAt: string }[];
    const lines = history.length
      ? history.map((entry) => `${entry.createdAt} • ${entry.action}`).join("\n")
      : "История пуста.";
    await ctx.reply(
      `Статус: ${user.isSuspected ? "подозрительный" : "чистый"}\nИстория:\n${lines}`
    );
  });

  bot.command("send", requireAdminChat, requirePermission(["send_message"]), async (ctx) => {
    const [_, telegramId, ...rest] = ctx.message.text.split(" ");
    const text = rest.join(" ").trim();
    if (!telegramId || !text) {
      await ctx.reply("Использование: /send <telegram_id> <text>");
      return;
    }
    try {
      await bot.telegram.sendMessage(telegramId, text);
      await ctx.reply("✅ Сообщение отправлено.");
      if (ctx.from) {
        logAdminAction(String(ctx.from.id), "send_message", telegramId);
      }
    } catch {
      await ctx.reply("❌ Не удалось отправить сообщение.");
    }
  });

  bot.command("broadcast", requireAdminChat, requirePermission(["broadcast"]), async (ctx) => {
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
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "broadcast", `sent:${sent} failed:${failed} blocked:${blocked}`);
    }
  });

  bot.command("payments", requireAdminChat, requirePermission(["manage_payments"]), async (ctx) => {
    const payments = getPaymentSettings();
    const message = [
      `DC: ${payments.dc ?? "не задано"}`,
      `Card: ${payments.card ?? "не задано"}`,
    ].join("\n");
    await ctx.reply(message);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "list_payments");
    }
  });

  bot.command("setpayment", requireAdminChat, requirePermission(["manage_payments"]), async (ctx) => {
    const [_, type] = ctx.message.text.split(" ");
    if (!type || !["dc", "card"].includes(type)) {
      await ctx.reply("Использование: /setpayment <dc|card>");
      return;
    }
    pendingPayments.set(String(ctx.from.id), { type: type as PendingPayment["type"] });
    await ctx.reply(`Отправьте текст реквизитов для ${type}.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "set_payment_prompt", type);
    }
  });

  bot.command("delpayment", requireAdminChat, requirePermission(["manage_payments"]), async (ctx) => {
    const [_, type] = ctx.message.text.split(" ");
    if (!type || !["dc", "card"].includes(type)) {
      await ctx.reply("Использование: /delpayment <dc|card>");
      return;
    }
    deletePaymentSetting(type as PendingPayment["type"], String(ctx.from.id));
    await ctx.reply(`✅ Реквизиты ${type} удалены.`);
    if (ctx.from) {
      logAdminAction(String(ctx.from.id), "delete_payment", type);
    }
  });

  bot.on(
    ["text", "photo"],
    requireAdminChatSilent,
    requirePermission(["manage_items", "manage_payments"]),
    async (ctx) => {
      const incomingText = ctx.message.text?.trim();
      if (incomingText?.startsWith("/")) {
        return;
      }
      const pendingAdmin = pendingAdminInputs.get(String(ctx.from.id));
      if (pendingAdmin) {
        const text = incomingText ?? "";
        const db = getDb();
        if (pendingAdmin.action === "edit_item") {
          const id = Number(text);
          if (!id) {
            await ctx.reply("Отправьте корректный ID товара.");
            return;
          }
          pendingAdminInputs.delete(String(ctx.from.id));
          pendingItems.set(String(ctx.from.id), { mode: "edit", id, step: "name" });
          await ctx.reply(`Введите новое название товара (#${id}).`);
          return;
        }
        if (pendingAdmin.action === "toggle_item") {
          const id = Number(text);
          if (!id) {
            await ctx.reply("Отправьте корректный ID товара.");
            return;
          }
          const item = db
            .prepare("SELECT is_active as isActive FROM items WHERE id = ?")
            .get(id) as { isActive: number } | undefined;
          if (!item) {
            await ctx.reply("Товар не найден.");
            return;
          }
          const next = item.isActive ? 0 : 1;
          db.prepare("UPDATE items SET is_active = ?, updated_at = ? WHERE id = ?").run(
            next,
            nowIso(),
            id
          );
          pendingAdminInputs.delete(String(ctx.from.id));
          await ctx.reply(`✅ Товар #${id} теперь ${next ? "включён" : "выключен"}.`);
          return;
        }
        if (pendingAdmin.action === "add_category") {
          if (!text) {
            await ctx.reply("Отправьте название категории.");
            return;
          }
          db.prepare("INSERT INTO categories (name, sort_order, is_active) VALUES (?, 0, 1)").run(text);
          pendingAdminInputs.delete(String(ctx.from.id));
          await ctx.reply("✅ Категория добавлена.");
          return;
        }
        if (pendingAdmin.action === "edit_category") {
          const [idRaw, ...rest] = text.split(" ");
          const id = Number(idRaw);
          const name = rest.join(" ").trim();
          if (!id || !name) {
            await ctx.reply("Отправьте: <id> <новое название>");
            return;
          }
          db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
          pendingAdminInputs.delete(String(ctx.from.id));
          await ctx.reply(`✅ Категория #${id} обновлена.`);
          return;
        }
        if (pendingAdmin.action === "toggle_category") {
          const id = Number(text);
          if (!id) {
            await ctx.reply("Отправьте корректный ID категории.");
            return;
          }
          const category = db
            .prepare("SELECT is_active as isActive FROM categories WHERE id = ?")
            .get(id) as { isActive: number } | undefined;
          if (!category) {
            await ctx.reply("Категория не найдена.");
            return;
          }
          const next = category.isActive ? 0 : 1;
          db.prepare("UPDATE categories SET is_active = ? WHERE id = ?").run(next, id);
          pendingAdminInputs.delete(String(ctx.from.id));
          await ctx.reply(`✅ Категория #${id} теперь ${next ? "включена" : "выключена"}.`);
          return;
        }
        if (pendingAdmin.action === "order_by_id") {
          const id = Number(text);
          if (!id) {
            await ctx.reply("Отправьте корректный ID заказа.");
            return;
          }
          const order = db
            .prepare(
              "SELECT orders.id, orders.status, orders.total_amount as totalAmount, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
            )
            .get(id) as { id: number; status: string; totalAmount: number; telegramId: string } | undefined;
          pendingAdminInputs.delete(String(ctx.from.id));
          if (!order) {
            await ctx.reply("Заказ не найден.");
            return;
          }
          await ctx.reply(`#${order.id} • ${order.status} • ${order.totalAmount} • user ${order.telegramId}`);
          return;
        }
        if (pendingAdmin.action === "order_by_user") {
          if (!text) {
            await ctx.reply("Отправьте telegram_id пользователя.");
            return;
          }
          const orders = db
            .prepare(
              "SELECT orders.id, orders.status, orders.total_amount as totalAmount FROM orders JOIN users ON users.id = orders.user_id WHERE users.telegram_id = ? ORDER BY orders.created_at DESC LIMIT 10"
            )
            .all(text) as { id: number; status: string; totalAmount: number }[];
          pendingAdminInputs.delete(String(ctx.from.id));
          if (!orders.length) {
            await ctx.reply("Заказы не найдены.");
            return;
          }
          await ctx.reply(orders.map((o) => `#${o.id} • ${o.status} • ${o.totalAmount}`).join("\n"));
          return;
        }
        if (pendingAdmin.action === "order_by_game") {
          if (!text) {
            await ctx.reply("Отправьте игровой ID.");
            return;
          }
          const orders = db
            .prepare(
              "SELECT id, status, total_amount as totalAmount FROM orders WHERE game_id = ? ORDER BY created_at DESC LIMIT 10"
            )
            .all(text) as { id: number; status: string; totalAmount: number }[];
          pendingAdminInputs.delete(String(ctx.from.id));
          if (!orders.length) {
            await ctx.reply("Заказы не найдены.");
            return;
          }
          await ctx.reply(orders.map((o) => `#${o.id} • ${o.status} • ${o.totalAmount}`).join("\n"));
          return;
        }
      }
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
      logAdminAction(String(ctx.from.id), "set_payment", pending.type);
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
        logAdminAction(String(ctx.from.id), "create_item", pendingItem.name ?? null);
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
        logAdminAction(String(ctx.from.id), "update_item", `item:${pendingItem.id}`);
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
  );

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
    if (!rolePermissions[admin.role]?.includes("confirm")) {
      await ctx.answerCbQuery("Нет прав.");
      return;
    }
    if (admin.role === "moderator" && status !== "WAIT_PAYMENT") {
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
    const result = db.transaction(() => {
      const now = nowIso();
      const update = db
        .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
        .run(status, now, orderId, expectedStatus);
      if (update.changes === 0) {
        return { error: true };
      }
      db.prepare(
        "INSERT INTO admin_actions (order_id, admin_telegram_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(orderId, String(ctx.from.id), action, note ?? null, now);
      db.prepare(
        "INSERT INTO order_status_history (order_id, status, changed_by, source, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(orderId, status, String(ctx.from.id), "bot", now);

      const orderUser = db
        .prepare(
          "SELECT users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?"
        )
        .get(orderId) as { telegramId: string } | undefined;
      return { orderUser };
    })();
    if ("error" in result) {
      await ctx.reply("⚠️ Невозможно выполнить действие: статус заказа изменился или заказ не найден.");
      return;
    }
    if (result.orderUser) {
      await bot.telegram.sendMessage(result.orderUser.telegramId, `Заказ #${orderId} обновлён: ${status}.`);
    }
    await ctx.answerCbQuery("Статус обновлён.");
  };

  bot.action(/order:approve:(\d+)/, async (ctx) => {
    if (!ctx.from) {
      return;
    }
    const orderId = Number(ctx.match?.[1]);
    if (!orderId) {
      await ctx.answerCbQuery("Неверный заказ.");
      return;
    }
    const key = `${ctx.from.id}:${orderId}`;
    const now = Date.now();
    pendingConfirmations.set(key, { orderId, expiresAt: now + 30_000 });
    await ctx.answerCbQuery("Подтвердите действие.");
    await ctx.reply(
      `Подтвердите оплату по заказу #${orderId} (30 сек).`,
      Markup.inlineKeyboard([Markup.button.callback("✅ Точно подтвердить", `order:approve_confirm:${orderId}`)])
    );
  });
  bot.action(/order:approve_confirm:(\d+)/, async (ctx) => {
    if (!ctx.from) {
      return;
    }
    const orderId = Number(ctx.match?.[1]);
    if (!orderId) {
      await ctx.answerCbQuery("Неверный заказ.");
      return;
    }
    const key = `${ctx.from.id}:${orderId}`;
    const pending = pendingConfirmations.get(key);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingConfirmations.delete(key);
      await ctx.answerCbQuery("Время подтверждения истекло.");
      return;
    }
    pendingConfirmations.delete(key);
    await handleStatusChange(ctx, "PAID", "approve", "REVIEW");
  });
  bot.action(/order:reject:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "REJECTED", "reject", "REVIEW");
  });
  bot.action(/order:request_proof:(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match?.[1]);
    if (!orderId) {
      await ctx.answerCbQuery("Неверный заказ.");
      return;
    }
    await handleStatusChange(
      ctx,
      "WAIT_PAYMENT",
      "request_proof",
      "REVIEW",
      `📎 Пришлите, пожалуйста, чек/скрин оплаты по заказу №${orderId}. Без чека мы не сможем подтвердить оплату.`
    );
  });
  bot.action(/order:complete:(\d+)/, async (ctx) => {
    await handleStatusChange(ctx, "DELIVERED", "complete", "PAID");
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
        "SELECT orders.id, orders.status, orders.created_at as createdAt, orders.reminder_sent_at as reminderSentAt, users.telegram_id as telegramId FROM orders JOIN users ON users.id = orders.user_id WHERE orders.status IN ('WAIT_PAYMENT', 'PROOF_SENT', 'REVIEW')"
      )
      .all() as { id: number; status: string; createdAt: string; reminderSentAt?: string | null; telegramId: string }[];

    for (const order of orders) {
      const createdAt = Date.parse(order.createdAt);
      const diffMinutes = (now - createdAt) / 60000;
      if (order.status === "REVIEW" && diffMinutes >= 10) {
        await bot.telegram.sendMessage(
          config.ADMIN_GROUP_ID,
          `⏱ Заказ #${order.id} ожидает проверки более 10 минут.`
        );
      }
      if (order.status !== "REVIEW" && diffMinutes >= cancelMinutes) {
        const nowIsoValue = nowIso();
        db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(
          "CLOSED",
          nowIsoValue,
          order.id
        );
        db.prepare(
          "INSERT INTO order_status_history (order_id, status, changed_by, source, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(order.id, "CLOSED", null, "worker", nowIsoValue);
        await bot.telegram.sendMessage(
          order.telegramId,
          `Заказ #${order.id} закрыт из-за отсутствия оплаты/чека.`
        );
      } else if (order.status !== "REVIEW" && diffMinutes >= remindMinutes && !order.reminderSentAt) {
        const reminderText =
          order.status === "PROOF_SENT"
            ? `Напоминание: нажмите «Я оплатил(а)» по заказу #${order.id}, чтобы отправить его на проверку.`
            : `Напоминание: оплатите заказ #${order.id} и загрузите чек для проверки.`;
        await bot.telegram.sendMessage(order.telegramId, reminderText);
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

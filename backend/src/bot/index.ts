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

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("orders", requireRole(["owner", "admin", "moderator"]), async (ctx) => {
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

  bot.command("grant", requireRole(["owner"]), async (ctx) => {
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

  bot.command("revoke", requireRole(["owner"]), async (ctx) => {
    const [_, telegramId] = ctx.message.text.split(" ");
    if (!telegramId) {
      await ctx.reply("Использование: /revoke <telegram_id>");
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM admins WHERE telegram_id = ?").run(telegramId);
    await ctx.reply(`✅ Доступ отозван у ${telegramId}.`);
  });

  bot.command("admins", requireRole(["owner"]), async (ctx) => {
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

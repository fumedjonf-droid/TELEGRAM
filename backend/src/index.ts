import { config } from "./config.js";
import { createBot, registerOrderActions, startOutboxWorker } from "./bot/index.js";
import { createServer } from "./api/server.js";
import { getDb, nowIso } from "./db/index.js";
import pino from "pino";

const logger = pino({ transport: { target: "pino-pretty" } });

const db = getDb();
const existingOwner = db
  .prepare("SELECT id FROM admins WHERE telegram_id = ?")
  .get(config.OWNER_TELEGRAM_ID) as { id: number } | undefined;
if (!existingOwner) {
  db.prepare(
    "INSERT INTO admins (telegram_id, role, added_by, created_at) VALUES (?, 'owner', ?, ?)"
  ).run(config.OWNER_TELEGRAM_ID, config.OWNER_TELEGRAM_ID, nowIso());
}

let bot: ReturnType<typeof createBot> | null = null;
if (config.BOT_ENABLED) {
  bot = createBot();
  registerOrderActions(bot);
  startOutboxWorker(bot);
} else {
  logger.info("Bot disabled via BOT_ENABLED=false");
}
const app = createServer();

app.listen(config.PORT, () => {
  logger.info(`API listening on :${config.PORT}`);
});

const startBot = async () => {
  if (!bot) {
    return;
  }
  try {
    await bot.launch();
    logger.info("Bot started");
  } catch (err) {
    logger.error({ err }, "Bot failed to start");
  }
};

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});

startBot();

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));

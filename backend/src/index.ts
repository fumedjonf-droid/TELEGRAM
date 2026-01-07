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

const bot = createBot();
registerOrderActions(bot);
startOutboxWorker(bot);
const app = createServer();

app.listen(config.PORT, () => {
  logger.info(`API listening on :${config.PORT}`);
});

bot.launch().then(() => {
  logger.info("Bot started");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

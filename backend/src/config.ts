import dotenv from "dotenv";

dotenv.config();

type RequiredEnv = {
  BOT_TOKEN: string;
  APP_URL: string;
  ADMIN_GROUP_ID: string;
  SQLITE_PATH: string;
  OWNER_TELEGRAM_ID: string;
  WEBAPP_ORIGIN: string;
};

const required = [
  "BOT_TOKEN",
  "APP_URL",
  "SQLITE_PATH",
  "OWNER_TELEGRAM_ID",
  "WEBAPP_ORIGIN",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const adminGroupId = process.env.ADMIN_CHAT_ID ?? process.env.ADMIN_GROUP_ID;
if (!adminGroupId) {
  throw new Error("Missing required env: ADMIN_CHAT_ID");
}

const botEnabled = process.env.BOT_ENABLED !== "false";

export const config: RequiredEnv & { PORT: number; BOT_ENABLED: boolean } = {
  BOT_TOKEN: process.env.BOT_TOKEN as string,
  APP_URL: process.env.APP_URL as string,
  ADMIN_GROUP_ID: adminGroupId,
  SQLITE_PATH: process.env.SQLITE_PATH as string,
  OWNER_TELEGRAM_ID: process.env.OWNER_TELEGRAM_ID as string,
  WEBAPP_ORIGIN: process.env.WEBAPP_ORIGIN as string,
  PORT: Number(process.env.PORT ?? 3000),
  BOT_ENABLED: botEnabled,
};

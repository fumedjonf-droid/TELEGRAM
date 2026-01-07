import dotenv from "dotenv";

dotenv.config();

type RequiredEnv = {
  BOT_TOKEN: string;
  APP_URL: string;
  ADMIN_GROUP_ID: string;
  SQLITE_PATH: string;
  OWNER_TELEGRAM_ID: string;
};

const required = [
  "BOT_TOKEN",
  "APP_URL",
  "ADMIN_GROUP_ID",
  "SQLITE_PATH",
  "OWNER_TELEGRAM_ID",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

export const config: RequiredEnv & { PORT: number } = {
  BOT_TOKEN: process.env.BOT_TOKEN as string,
  APP_URL: process.env.APP_URL as string,
  ADMIN_GROUP_ID: process.env.ADMIN_GROUP_ID as string,
  SQLITE_PATH: process.env.SQLITE_PATH as string,
  OWNER_TELEGRAM_ID: process.env.OWNER_TELEGRAM_ID as string,
  PORT: Number(process.env.PORT ?? 3000),
};

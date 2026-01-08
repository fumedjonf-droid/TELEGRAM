import crypto from "crypto";

const parseInitData = (initData: string): Map<string, string> => {
  const params = new URLSearchParams(initData);
  const data = new Map<string, string>();
  params.forEach((value, key) => {
    data.set(key, value);
  });
  return data;
};

export const validateInitData = (initData: string, botToken: string, maxAgeSeconds = 300): boolean => {
  const data = parseInitData(initData);
  const hash = data.get("hash");
  if (!hash) {
    return false;
  }
  const authDate = data.get("auth_date");
  if (!authDate) {
    return false;
  }
  const authTimestamp = Number(authDate);
  if (!Number.isFinite(authTimestamp)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authTimestamp > maxAgeSeconds) {
    return false;
  }
  data.delete("hash");
  const sorted = [...data.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (calculatedHash.length !== hash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash));
};

export const parseUserFromInitData = (initData: string): {
  id: string;
  username?: string;
  first_name?: string;
} | null => {
  const data = parseInitData(initData);
  const userRaw = data.get("user");
  if (!userRaw) {
    return null;
  }
  const parsed = JSON.parse(userRaw) as { id: number; username?: string; first_name?: string };
  return {
    id: String(parsed.id),
    username: parsed.username,
    first_name: parsed.first_name,
  };
};

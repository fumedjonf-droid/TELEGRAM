import { apiClient } from "./client";

export const resolveIdentity = (payload: { gameKey: string; region?: string; playerId: string }) =>
  apiClient<{ ok: boolean; playerId: string; nickname: string }>("/api/identity/resolve", {
    method: "POST",
    body: JSON.stringify(payload),
  });

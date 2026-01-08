import { apiClient } from "./client";

export const checkGameId = (gameId: string) =>
  apiClient<{ ok: boolean; nickname: string }>("/api/game/check", {
    method: "POST",
    body: JSON.stringify({ gameId }),
  });

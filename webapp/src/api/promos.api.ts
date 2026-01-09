import { apiClient } from "./client";

export type PromoResponse = {
  ok: boolean;
  code: string;
  type: "percent" | "fixed";
  value: number;
  expiresAt?: string | null;
};

export const validatePromo = (code: string) =>
  apiClient<PromoResponse>("/api/promos/validate", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

import { apiClient } from "./client";

export type PaymentSettings = {
  dc: string | null;
  card: string | null;
  qr: string | null;
};

export const fetchPayments = () => apiClient<PaymentSettings>("/api/payments");

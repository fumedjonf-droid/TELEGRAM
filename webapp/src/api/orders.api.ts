import { apiClient } from "./client";

export type OrderItemPayload = { itemId: number; qty: number };

export type CreateOrderResponse = {
  orderId: number;
  status: string;
  totalAmount: number;
};

export type OrderSummary = {
  id: number;
  status: string;
  totalAmount: number;
  createdAt: string;
};

export type OrderDetails = OrderSummary & {
  gameId: string;
  gameNick?: string | null;
  paymentMethod: string;
  proofFileId?: string | null;
  proofPath?: string | null;
  items: { name: string; qty: number; priceSnapshot: number }[];
};

export const createOrder = (payload: {
  gameId: string;
  gameNick?: string | null;
  paymentMethod: string;
  items: OrderItemPayload[];
}) => apiClient<CreateOrderResponse>("/api/orders", {
  method: "POST",
  body: JSON.stringify(payload),
});

export const fetchMyOrders = () => apiClient<OrderSummary[]>("/api/orders/my");

export const fetchOrderDetails = (id: number) => apiClient<OrderDetails>(`/api/orders/${id}`);

export const markPaid = (id: number) =>
  apiClient<{ ok: boolean; status: string }>(`/api/orders/${id}/mark-paid`, {
    method: "POST",
  });

export const uploadProof = async (id: number, file: File) => {
  const initData = window.Telegram?.WebApp?.initData;
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`/api/orders/${id}/proof`, {
    method: "POST",
    headers: initData ? { "X-TG-INIT-DATA": initData } : undefined,
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ ok: boolean }>;
};

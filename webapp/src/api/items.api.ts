import { apiClient } from "./client";

export type Item = {
  id: number;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  imageFileId?: string;
  categoryId?: number;
  categoryName?: string | null;
  gameKey: string;
  region: string;
  idRules?: string | null;
  providerKey?: string | null;
  deliveryType?: string | null;
};

export type Category = {
  id: number;
  name: string;
  iconUrl?: string;
};

export const fetchItems = () => apiClient<Item[]>("/api/items");
export const fetchCategories = () => apiClient<Category[]>("/api/categories");

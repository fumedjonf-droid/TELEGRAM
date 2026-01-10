import { apiClient } from "./client";

export type Category = {
  id: number;
  name: string;
  iconUrl?: string | null;
  sortOrder?: number | null;
  isActive?: number | null;
};

export const fetchCategories = () => apiClient<Category[]>("/api/categories");

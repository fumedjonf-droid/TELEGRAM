import { create } from "zustand";

export type CartItem = {
  itemId: number;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string;
};

const storageKey = "shop_cart";

const loadItems = (): CartItem[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as CartItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveItems = (items: CartItem[]) => {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(items));
};

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "qty">, qty?: number) => void;
  updateQty: (itemId: number, qty: number) => void;
  removeItem: (itemId: number) => void;
  clear: () => void;
  totalQty: () => number;
  totalPrice: () => number;
};

export const useCartStore = create<CartState>((set, get) => ({
  items: loadItems(),
  addItem: (item, qty = 1) =>
    set((state) => {
      const existing = state.items.find((entry) => entry.itemId === item.itemId);
      if (existing) {
        const items = state.items.map((entry) =>
          entry.itemId === item.itemId ? { ...entry, qty: entry.qty + qty } : entry
        );
        saveItems(items);
        return { items };
      }
      const items = [...state.items, { ...item, qty }];
      saveItems(items);
      return { items };
    }),
  updateQty: (itemId, qty) =>
    set((state) => {
      const items = state.items.map((entry) =>
        entry.itemId === itemId ? { ...entry, qty } : entry
      );
      saveItems(items);
      return { items };
    }),
  removeItem: (itemId) =>
    set((state) => {
      const items = state.items.filter((entry) => entry.itemId !== itemId);
      saveItems(items);
      return { items };
    }),
  clear: () => {
    saveItems([]);
    set({ items: [] });
  },
  totalQty: () => get().items.reduce((sum, entry) => sum + entry.qty, 0),
  totalPrice: () => get().items.reduce((sum, entry) => sum + entry.price * entry.qty, 0)
}));

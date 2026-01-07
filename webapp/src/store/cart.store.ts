import { create } from "zustand";

export type CartItem = {
  itemId: number;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string;
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
  items: [],
  addItem: (item, qty = 1) =>
    set((state) => {
      const existing = state.items.find((entry) => entry.itemId === item.itemId);
      if (existing) {
        return {
          items: state.items.map((entry) =>
            entry.itemId === item.itemId ? { ...entry, qty: entry.qty + qty } : entry
          )
        };
      }
      return { items: [...state.items, { ...item, qty }] };
    }),
  updateQty: (itemId, qty) =>
    set((state) => ({
      items: state.items.map((entry) =>
        entry.itemId === itemId ? { ...entry, qty } : entry
      )
    })),
  removeItem: (itemId) =>
    set((state) => ({ items: state.items.filter((entry) => entry.itemId !== itemId) })),
  clear: () => set({ items: [] }),
  totalQty: () => get().items.reduce((sum, entry) => sum + entry.qty, 0),
  totalPrice: () => get().items.reduce((sum, entry) => sum + entry.price * entry.qty, 0)
}));

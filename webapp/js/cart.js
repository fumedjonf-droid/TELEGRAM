const listeners = new Set();
const cartItems = new Map();

export const subscribe = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

const notify = () => {
  listeners.forEach((callback) => callback());
};

export const addItem = (productId) => {
  const current = cartItems.get(productId) || 0;
  cartItems.set(productId, current + 1);
  notify();
};

export const removeItem = (productId) => {
  cartItems.delete(productId);
  notify();
};

export const setQuantity = (productId, quantity) => {
  if (quantity <= 0) {
    cartItems.delete(productId);
  } else {
    cartItems.set(productId, quantity);
  }
  notify();
};

export const clearCart = () => {
  cartItems.clear();
  notify();
};

export const getCartItems = () => Array.from(cartItems.entries());

export const getCartCount = () =>
  Array.from(cartItems.values()).reduce((sum, qty) => sum + qty, 0);

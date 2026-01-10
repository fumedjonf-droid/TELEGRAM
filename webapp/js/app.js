import { categories } from "./data.js";
import { subscribe, getCartCount, clearCart } from "./cart.js";
import {
  renderCategories,
  renderProducts,
  renderSkeletons,
  renderCart,
  updateCartBadge,
  updateTotals,
  getCartTotal,
  toggleCartBar,
  toggleBottomSheet,
  setActiveCategoryLabel,
  showOrderStatus,
  hideOrderStatus,
  bindRemoveAll,
} from "./ui.js";
import { sanitizeNumeric, validateAccountId } from "./validators.js";

const state = {
  activeCategory: categories[0].id,
  isSheetOpen: false,
};

const init = () => {
  renderCategories(state.activeCategory);
  setActiveCategoryLabel(categories[0].title);
  renderSkeletons(3);

  setTimeout(() => {
    renderProducts(state.activeCategory);
  }, 700);

  bindCategoryEvents();
  bindCartEvents();
  bindCheckout();
  bindStatus();

  subscribe(onCartChange);
  onCartChange();
};

const bindCategoryEvents = () => {
  document.getElementById("categoryGrid").addEventListener("click", (event) => {
    const tile = event.target.closest(".category-tile");
    if (!tile) return;
    const categoryId = tile.dataset.category;
    state.activeCategory = categoryId;
    renderCategories(categoryId);
    setActiveCategoryLabel(
      categories.find((category) => category.id === categoryId)?.title ?? ""
    );
    renderSkeletons(3);
    setTimeout(() => renderProducts(categoryId), 600);
  });
};

const bindCartEvents = () => {
  const openCart = () => {
    state.isSheetOpen = true;
    toggleBottomSheet(true);
    renderCart();
    bindRemoveAll();
  };

  const closeCart = () => {
    state.isSheetOpen = false;
    toggleBottomSheet(false);
  };

  document.getElementById("openCart").addEventListener("click", openCart);
  document.getElementById("openCartTop").addEventListener("click", openCart);
  document.getElementById("closeCart").addEventListener("click", closeCart);
  document.getElementById("sheetBackdrop").addEventListener("click", closeCart);

  subscribe(() => {
    if (state.isSheetOpen) {
      renderCart();
      bindRemoveAll();
    }
  });
};

const bindCheckout = () => {
  const input = document.getElementById("accountId");
  const error = document.getElementById("idError");
  input.addEventListener("input", () => {
    input.value = sanitizeNumeric(input.value);
    error.textContent = "";
  });

  document.getElementById("submitOrder").addEventListener("click", () => {
    const value = input.value.trim();
    const message = validateAccountId(value);
    if (message) {
      error.textContent = message;
      return;
    }
    error.textContent = "";
    const orderId = Math.floor(100000 + Math.random() * 900000);
    showOrderStatus(orderId);
    input.value = "";
    clearCart();
    toggleBottomSheet(false);
  });
};

const bindStatus = () => {
  document.getElementById("backToCatalog").addEventListener("click", () => {
    hideOrderStatus();
  });
};

const onCartChange = () => {
  const count = getCartCount();
  toggleCartBar(count > 0);
  updateCartBadge(true);
  const total = getCartTotal();
  updateTotals(total);
};

window.addEventListener("DOMContentLoaded", init);

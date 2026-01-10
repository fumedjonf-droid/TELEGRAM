import { categories, findProduct, getProductsByCategory } from "./data.js";
import { addItem, getCartItems, getCartCount, removeItem, setQuantity } from "./cart.js";

export const renderCategories = (activeCategoryId) => {
  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = "";
  categories.forEach((category) => {
    const tile = document.createElement("button");
    tile.className = `category-tile ${category.style}`;
    tile.dataset.category = category.id;
    if (category.id === activeCategoryId) {
      tile.classList.add("active");
    }

    tile.innerHTML = `
      <div class="label">${category.title}</div>
      <span class="category-caption">Популярные наборы</span>
    `;

    grid.appendChild(tile);
  });
};

const buildProductCard = (product, index) => {
  const card = document.createElement("div");
  card.className = "product-card";
  card.style.setProperty("--stagger", index);
  card.innerHTML = `
    <div class="product-thumb">${product.name}</div>
    <div class="product-meta">
      <div>
        <p>${product.name}</p>
        <span class="caption">Моментальная доставка</span>
      </div>
      <div class="price">${product.price} ₽</div>
    </div>
    <button class="primary-button" data-add="${product.id}">Добавить</button>
  `;
  return card;
};

export const renderSkeletons = (count = 3) => {
  const grid = document.getElementById("productGrid");
  grid.innerHTML = "";
  Array.from({ length: count }).forEach(() => {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    grid.appendChild(skeleton);
  });
};

export const renderProducts = (categoryId) => {
  const grid = document.getElementById("productGrid");
  grid.innerHTML = "";
  const products = getProductsByCategory(categoryId);
  products.forEach((product, index) => {
    grid.appendChild(buildProductCard(product, index));
  });
  grid.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addItem(button.dataset.add));
  });
};

export const renderCart = () => {
  const container = document.getElementById("cartItems");
  container.innerHTML = "";
  const items = getCartItems();

  if (!items.length) {
    container.innerHTML = '<p class="caption">Корзина пуста. Добавьте товары из каталога.</p>';
    return;
  }

  items.forEach(([productId, qty]) => {
    const product = findProduct(productId);
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div>
        <div class="cart-item-title">${product.name}</div>
        <div class="caption">${product.price} ₽ за штуку</div>
      </div>
      <div class="quantity">
        <button data-minus="${productId}">−</button>
        <span>${qty}</span>
        <button data-plus="${productId}">+</button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-minus]").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.minus;
      const current = items.find(([id]) => id === productId)?.[1] ?? 0;
      setQuantity(productId, current - 1);
    });
  });

  container.querySelectorAll("[data-plus]").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.plus;
      const current = items.find(([id]) => id === productId)?.[1] ?? 0;
      setQuantity(productId, current + 1);
    });
  });
};

export const updateCartBadge = (shouldPulse = false) => {
  const count = getCartCount();
  const badge = document.getElementById("cartCount");
  badge.textContent = String(count);
  if (shouldPulse) {
    badge.classList.remove("pulse");
    requestAnimationFrame(() => badge.classList.add("pulse"));
  }
};

export const updateTotals = (total) => {
  document.getElementById("cartTotal").textContent = `${total} ₽`;
  document.getElementById("sheetTotal").textContent = `${total} ₽`;
};

export const getCartTotal = () => {
  const items = getCartItems();
  return items.reduce((sum, [productId, qty]) => {
    const product = findProduct(productId);
    return sum + product.price * qty;
  }, 0);
};

export const toggleCartBar = (visible) => {
  const cartBar = document.getElementById("cartBar");
  cartBar.classList.toggle("hidden", !visible);
};

export const toggleBottomSheet = (open) => {
  document.getElementById("bottomSheet").classList.toggle("open", open);
  document.getElementById("sheetBackdrop").classList.toggle("open", open);
};

export const setActiveCategoryLabel = (label) => {
  document.getElementById("activeCategoryLabel").textContent = label;
};

export const showOrderStatus = (orderId) => {
  const status = document.getElementById("orderStatus");
  status.classList.remove("hidden");
  document.getElementById("statusText").textContent =
    `Заказ #${orderId} отправлен. Ожидает подтверждения оператора.`;
  status.scrollIntoView({ behavior: "smooth", block: "start" });
};

export const hideOrderStatus = () => {
  document.getElementById("orderStatus").classList.add("hidden");
};

export const bindRemoveAll = () => {
  const container = document.getElementById("cartItems");
  if (getCartItems().length > 0) {
    const clearButton = document.createElement("button");
    clearButton.className = "ghost-button";
    clearButton.textContent = "Очистить корзину";
    clearButton.addEventListener("click", () => {
      getCartItems().forEach(([productId]) => removeItem(productId));
    });
    container.appendChild(clearButton);
  }
};

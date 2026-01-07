const categoryThemes = {
  FreeFire: {
    name: "Free Fire",
    background: "url('https://images.unsplash.com/photo-1605902711622-cfb43c4437d1?auto=format&fit=crop&w=900&q=80')",
  },
  PUBG: {
    name: "PUBG Mobile",
    background: "url('https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=900&q=80')",
  },
  Steam: {
    name: "Steam",
    background: "url('https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80')",
  },
  Other: {
    name: "Другое",
    background: "url('https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80')",
  },
};

const paymentMethods = [
  {
    id: "card",
    label: "Карта",
    requisites: "2200 7012 3456 7890",
    bank: "Тинькофф",
    recipient: "Иван П.",
  },
  {
    id: "sbp",
    label: "СБП",
    requisites: "+7 999 555-44-33",
    bank: "Сбербанк",
    recipient: "ООО Донат Сервис",
  },
  {
    id: "dc",
    label: "DC кошелек",
    requisites: "U123456789",
    bank: "DC",
    recipient: "Donat Center",
  },
];

const state = {
  currentView: "games",
  history: [],
  items: [],
  categories: [],
  selectedCategory: null,
  selectedItem: null,
  playerId: "",
  nickname: "",
  playerVerified: false,
  selectedPayment: null,
  orderId: "",
  orderCode: "",
  requisites: null,
  user: null,
  initData: "",
};

const backButton = document.getElementById("backButton");
const appHeader = document.getElementById("appHeader");
const headerTitle = document.getElementById("headerTitle");
const appContent = document.getElementById("appContent");

const viewTemplates = {
  games: document.getElementById("gamesView"),
  products: document.getElementById("productsView"),
  checkout: document.getElementById("checkoutView"),
  payment: document.getElementById("paymentView"),
  proof: document.getElementById("proofView"),
  status: document.getElementById("statusView"),
};

function setView(view) {
  state.currentView = view;
  render();
}

function pushView(view) {
  state.history.push(state.currentView);
  setView(view);
}

function popView() {
  const previous = state.history.pop();
  if (previous) {
    setView(previous);
    return;
  }
  closeWebApp();
}

function closeWebApp() {
  const telegram = window.Telegram?.WebApp;
  if (telegram?.close) {
    telegram.close();
    return;
  }
  window.close();
}

function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();

  state.initData = tg.initData || "";
  state.user = tg.initDataUnsafe?.user || null;

  tg.BackButton.onClick(() => {
    popView();
  });

  updateTelegramBackButton();
}

function updateTelegramBackButton() {
  const telegram = window.Telegram?.WebApp;
  if (!telegram?.BackButton) return;

  if (state.currentView === "games") {
    telegram.BackButton.hide();
  } else {
    telegram.BackButton.show();
  }
}

function render() {
  appContent.innerHTML = "";
  const template = viewTemplates[state.currentView];
  if (!template) return;

  const content = template.content.cloneNode(true);
  appContent.appendChild(content);

  updateHeader();

  if (state.currentView === "games") {
    renderGames();
  }
  if (state.currentView === "products") {
    renderProducts();
  }
  if (state.currentView === "checkout") {
    renderCheckout();
  }
  if (state.currentView === "payment") {
    renderPayment();
  }
  if (state.currentView === "proof") {
    renderProof();
  }
  if (state.currentView === "status") {
    renderStatus();
  }

  updateTelegramBackButton();
}

function updateHeader() {
  const titles = {
    games: "Каталог игр",
    products: state.selectedCategory?.name || "Каталог товаров",
    checkout: "Оформление заказа",
    payment: "Оплата",
    proof: "Подтверждение",
    status: "Статус заказа",
  };
  headerTitle.textContent = titles[state.currentView] || "";
  if (appHeader) {
    appHeader.style.display = state.currentView === "games" ? "none" : "flex";
  }
}

function renderGames() {
  const grid = appContent.querySelector("[data-view='games']");
  if (!state.categories.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Каталог пока пуст.";
    grid.appendChild(empty);
    return;
  }

  state.categories.forEach((category) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.style.setProperty("--game-bg", category.background || "none");
    card.innerHTML = `<div><h3>${category.name}</h3><p>${category.description || ""}</p></div>`;
    card.addEventListener("click", () => {
      state.selectedCategory = category;
      state.selectedItem = null;
      pushView("products");
    });
    grid.appendChild(card);
  });
}

function renderProducts() {
  const grid = appContent.querySelector("[data-view='products']");
  const purchaseCta = appContent.querySelector("[data-role='purchase-cta']");
  const purchaseButton = appContent.querySelector("#purchaseButton");

  grid.innerHTML = "";

  const items = state.items.filter((item) => item.category === state.selectedCategory?.id);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Каталог скоро появится. Следите за обновлениями!";
    grid.appendChild(empty);
    purchaseCta.hidden = true;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-card__image">
        <img src="${buildImageUrl(item.imageUrl) || "assets/free-fire.svg"}" alt="${item.title}" />
      </div>
      <div>
        <h3>${item.title}</h3>
        <p>${state.selectedCategory?.name || ""}</p>
        <div class="product-meta">
          <strong>${item.price} ${item.currency}</strong>
          <button class="secondary-button" type="button">${
            state.selectedItem?.id === item.id ? "Выбрано" : "Выбрать"
          }</button>
        </div>
      </div>
    `;

    const button = card.querySelector("button");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectItem(item);
    });

    card.addEventListener("click", () => selectItem(item));

    if (state.selectedItem?.id === item.id) {
      card.classList.add("selected");
    }

    grid.appendChild(card);
  });

  if (state.selectedItem) {
    purchaseCta.hidden = false;
    purchaseButton.textContent = `Купить ${state.selectedItem.title} за ${state.selectedItem.price} ${state.selectedItem.currency}`;
    purchaseButton.addEventListener("click", () => pushView("checkout"));
  } else {
    purchaseCta.hidden = true;
  }
}

function selectItem(item) {
  state.selectedItem = item;
  render();
}

function renderCheckout() {
  const orderGame = appContent.querySelector("[data-role='order-game']");
  const orderProduct = appContent.querySelector("[data-role='order-product']");
  const orderPrice = appContent.querySelector("[data-role='order-price']");

  orderGame.textContent = `Категория: ${state.selectedCategory?.name || ""}`;
  orderProduct.textContent = `Товар: ${state.selectedItem.title}`;
  orderPrice.textContent = `Цена: ${state.selectedItem.price} ${state.selectedItem.currency}`;

  const playerIdInput = appContent.querySelector("#playerId");
  const verifyButton = appContent.querySelector("#verifyButton");
  const playerSummary = appContent.querySelector("[data-role='player-summary']");
  const paymentSection = appContent.querySelector("[data-role='payment-section']");
  const paymentGrid = appContent.querySelector("#paymentMethods");
  const proceedButton = appContent.querySelector("#proceedToPayment");

  playerIdInput.value = state.playerId;
  playerIdInput.disabled = state.playerVerified;
  verifyButton.textContent = state.playerVerified ? "Изменить ID" : "Проверить ID";

  if (state.playerVerified) {
    const nick = state.nickname ? `Никнейм: ${state.nickname}` : "Никнейм не найден";
    playerSummary.innerHTML = `<strong>ID:</strong> ${state.playerId}<br /><span>${nick}</span>`;
    playerSummary.hidden = false;
  } else {
    playerSummary.hidden = true;
  }

  paymentSection.setAttribute("aria-disabled", state.playerVerified ? "false" : "true");
  paymentGrid.innerHTML = "";

  paymentMethods.forEach((method) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "payment-option";
    option.innerHTML = `<span>${method.label}</span><small>${method.bank}</small>`;
    if (state.selectedPayment?.id === method.id) {
      option.classList.add("selected");
    }
    option.addEventListener("click", () => {
      state.selectedPayment = method;
      updateProceedButton(proceedButton);
      renderCheckout();
    });
    paymentGrid.appendChild(option);
  });

  verifyButton.addEventListener("click", async () => {
    if (state.playerVerified) {
      state.playerVerified = false;
      state.nickname = "";
      state.selectedPayment = null;
      render();
      return;
    }

    const value = playerIdInput.value.trim();
    if (!value) {
      playerIdInput.focus();
      return;
    }

    verifyButton.disabled = true;
    verifyButton.textContent = "Проверяем...";

    const result = await verifyPlayer(state.selectedCategory?.id || "unknown", value);
    state.playerId = value;
    state.playerVerified = result.valid;
    state.nickname = result.nickname;
    verifyButton.disabled = false;

    render();
  });

  updateProceedButton(proceedButton);

  proceedButton.addEventListener("click", async () => {
    if (!state.playerVerified || !state.selectedPayment) return;

    const order = await createOrder({
      itemId: state.selectedItem.id,
      playerId: state.playerId,
      nickname: state.nickname,
      paymentMethod: state.selectedPayment.id,
    });

    state.orderId = order.id;
    state.orderCode = order.code;
    state.requisites = order.requisites;

    pushView("payment");
  });
}

function updateProceedButton(button) {
  button.hidden = !(state.playerVerified && state.selectedPayment);
}

function renderPayment() {
  const requisites = state.requisites || state.selectedPayment;

  appContent.querySelector("[data-role='payment-game']").textContent = `Категория: ${state.selectedCategory?.name || ""}`;
  appContent.querySelector("[data-role='payment-product']").textContent = `Товар: ${state.selectedItem.title}`;
  appContent.querySelector("[data-role='payment-price']").textContent = `Сумма: ${state.selectedItem.price} ${state.selectedItem.currency}`;
  appContent.querySelector("[data-role='payment-code']").textContent = `Код заказа: ${state.orderCode}`;

  appContent.querySelector("[data-role='payment-requisites']").textContent = `Реквизиты: ${requisites.requisites}`;
  appContent.querySelector("[data-role='payment-bank']").textContent = `Банк: ${requisites.bank}`;
  appContent.querySelector("[data-role='payment-recipient']").textContent = `Получатель: ${requisites.recipient}`;

  appContent.querySelector("#copyRequisites").addEventListener("click", () => {
    copyToClipboard(requisites.requisites);
  });

  appContent.querySelector("#copyCode").addEventListener("click", () => {
    copyToClipboard(state.orderCode);
  });

  appContent.querySelector("#paidButton").addEventListener("click", () => {
    pushView("proof");
  });
}

function renderProof() {
  const submitButton = appContent.querySelector("#submitProof");
  const receiptUpload = appContent.querySelector("#receiptUpload");
  const commentInput = appContent.querySelector("#comment");
  const cardSuffixInput = appContent.querySelector("#cardSuffix");

  submitButton.addEventListener("click", async () => {
    if (!receiptUpload.files.length) {
      receiptUpload.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Отправляем...";

    await submitPaymentProof({
      orderId: state.orderId,
      receipt: receiptUpload.files[0],
      comment: commentInput.value.trim(),
      cardSuffix: cardSuffixInput.value.trim(),
    });

    submitButton.disabled = false;
    submitButton.textContent = "Отправить заявку";

    pushView("status");
  });
}

function renderStatus() {
  const statusCode = appContent.querySelector("[data-role='status-code']");
  statusCode.textContent = `Код заказа: ${state.orderCode}`;
}

async function verifyPlayer(gameId, playerId) {
  const payload = { gameId, playerId };
  const response = await apiRequest("/api/verify-player", payload);

  if (response) {
    return {
      valid: response.valid,
      nickname: response.nickname || "",
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 600));

  const simpleCheck = /\d{6,}/.test(playerId);
  const nickname = simpleCheck && gameId === "free-fire" ? `FF-${playerId.slice(-4)}` : "";

  return { valid: simpleCheck, nickname };
}

async function createOrder(payload) {
  const response = await apiRequest("/api/orders", payload);

  if (response) {
    return {
      id: response.id,
      code: response.code,
      requisites: {
        requisites: response.requisites.number,
        bank: response.requisites.bank,
        recipient: response.requisites.recipient,
      },
    };
  }

  return {
    id: crypto.randomUUID(),
    code: generateOrderCode(),
    requisites: state.selectedPayment,
  };
}

async function submitPaymentProof({ orderId, receipt, comment, cardSuffix }) {
  if (!orderId) return;

  const formData = new FormData();
  formData.append("receipt", receipt);
  formData.append("comment", comment);
  formData.append("cardSuffix", cardSuffix);
  formData.append("initData", state.initData);

  const response = await fetch(`/api/orders/${orderId}/proof`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    return false;
  }

  return response.json();
}

function generateOrderCode() {
  const prefix = state.selectedCategory?.name?.slice(0, 2).toUpperCase() || "MY";
  const suffix = Math.floor(Math.random() * 900000 + 100000);
  return `${prefix}-${suffix}`;
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}

backButton.addEventListener("click", popView);

async function apiRequest(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": state.initData,
      },
      body: JSON.stringify({
        ...payload,
        telegramUserId: state.user?.id || null,
      }),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initTelegram();
  loadItems();
});

async function loadItems() {
  try {
    const response = await fetch("/api/items");
    if (!response.ok) throw new Error("Failed to load items");
    const data = await response.json();
    state.items = data.items || [];
    state.categories = buildCategories(state.items);
  } catch (error) {
    state.items = [];
    state.categories = [];
  }
  render();
}

function buildCategories(items) {
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  const categories = Object.keys(grouped).map((category) => {
    const theme = categoryThemes[category] || categoryThemes.Other;
    return {
      id: category,
      name: theme?.name || category,
      description: `${grouped[category].length} товаров`,
      background: theme?.background || "none",
    };
  });
  return categories.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function buildImageUrl(pathValue) {
  if (!pathValue) return "";
  if (pathValue.startsWith("http")) return pathValue;
  return `${window.location.origin}${pathValue}`;
}

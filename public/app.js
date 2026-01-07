const games = [
  {
    id: "free-fire",
    name: "Free Fire",
    description: "Алмазы и пополнение",
    background: "url('https://images.unsplash.com/photo-1605902711622-cfb43c4437d1?auto=format&fit=crop&w=900&q=80')",
    productImage: "assets/free-fire.svg",
    products: [
      { id: "ff-105", amount: "105 алмазов", price: 89 },
      { id: "ff-326", amount: "326 алмазов", price: 239 },
      { id: "ff-431", amount: "431 алмазов", price: 299 },
      { id: "ff-546", amount: "546 алмазов", price: 399 },
      { id: "ff-1133", amount: "1133 алмазов", price: 789 },
      { id: "ff-1439", amount: "1439 алмазов", price: 999 },
      { id: "ff-659", amount: "659 алмазов", price: 479 },
      { id: "ff-2398", amount: "2398 алмазов", price: 1699 },
      { id: "ff-6160", amount: "6160 алмазов", price: 4399 },
      { id: "ff-12320", amount: "12320 алмазов", price: 8699 },
      { id: "ff-18", amount: "18 алмазов", price: 29 },
      { id: "ff-480", amount: "480 алмазов", price: 349 },
    ],
  },
  {
    id: "steam",
    name: "Steam",
    description: "Пополнение баланса",
    background: "url('https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80')",
    products: [
      { id: "steam-500", amount: "500 ₽", price: 550 },
      { id: "steam-1000", amount: "1000 ₽", price: 1090 },
      { id: "steam-2000", amount: "2000 ₽", price: 2150 },
    ],
  },
  {
    id: "pubg",
    name: "PUBG Mobile",
    description: "UC пакеты",
    background: "url('https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=900&q=80')",
    products: [
      { id: "pubg-60", amount: "60 UC", price: 119 },
      { id: "pubg-325", amount: "325 UC", price: 579 },
      { id: "pubg-660", amount: "660 UC", price: 1129 },
    ],
  },
  {
    id: "tg-stars",
    name: "TG Stars",
    description: "Звезды Telegram",
    background: "url('https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80')",
    products: [],
  },
  {
    id: "mobile-legends",
    name: "Mobile Legends",
    description: "Diamonds",
    background: "url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80')",
    products: [],
  },
];

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
  selectedGame: null,
  selectedProduct: null,
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
    products: state.selectedGame?.name || "Каталог товаров",
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
  games.forEach((game) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.style.setProperty("--game-bg", game.background || "none");
    card.innerHTML = `<div><h3>${game.name}</h3><p>${game.description}</p></div>`;
    card.addEventListener("click", () => {
      state.selectedGame = game;
      state.selectedProduct = null;
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

  if (!state.selectedGame.products.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Каталог скоро появится. Следите за обновлениями!";
    grid.appendChild(empty);
    purchaseCta.hidden = true;
    return;
  }

  state.selectedGame.products.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-card__image">
        <img src="${state.selectedGame.productImage || "assets/free-fire.svg"}" alt="${product.amount}" />
      </div>
      <div>
        <h3>${product.amount}</h3>
        <p>${state.selectedGame.name}</p>
        <div class="product-meta">
          <strong>${product.price} ₽</strong>
          <button class="secondary-button" type="button">${
            state.selectedProduct?.id === product.id ? "Выбрано" : "Выбрать"
          }</button>
        </div>
      </div>
    `;

    const button = card.querySelector("button");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectProduct(product);
    });

    card.addEventListener("click", () => selectProduct(product));

    if (state.selectedProduct?.id === product.id) {
      card.classList.add("selected");
    }

    grid.appendChild(card);
  });

  if (state.selectedProduct) {
    purchaseCta.hidden = false;
    purchaseButton.textContent = `Купить ${state.selectedProduct.amount} за ${state.selectedProduct.price} ₽`;
    purchaseButton.addEventListener("click", () => pushView("checkout"));
  } else {
    purchaseCta.hidden = true;
  }
}

function selectProduct(product) {
  state.selectedProduct = product;
  render();
}

function renderCheckout() {
  const orderGame = appContent.querySelector("[data-role='order-game']");
  const orderProduct = appContent.querySelector("[data-role='order-product']");
  const orderPrice = appContent.querySelector("[data-role='order-price']");

  orderGame.textContent = `Игра: ${state.selectedGame.name}`;
  orderProduct.textContent = `Товар: ${state.selectedProduct.amount}`;
  orderPrice.textContent = `Цена: ${state.selectedProduct.price} ₽`;

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

    const result = await verifyPlayer(state.selectedGame.id, value);
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
      gameId: state.selectedGame.id,
      productId: state.selectedProduct.id,
      amount: state.selectedProduct.amount,
      price: state.selectedProduct.price,
      currency: "RUB",
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

  appContent.querySelector("[data-role='payment-game']").textContent = `Игра: ${state.selectedGame.name}`;
  appContent.querySelector("[data-role='payment-product']").textContent = `Товар: ${state.selectedProduct.amount}`;
  appContent.querySelector("[data-role='payment-price']").textContent = `Сумма: ${state.selectedProduct.price} ₽`;
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
  const prefix = state.selectedGame.name.slice(0, 2).toUpperCase();
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
  render();
});

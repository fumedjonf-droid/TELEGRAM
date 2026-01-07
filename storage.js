const fs = require("fs");
const path = require("path");

const ordersPath = path.join(__dirname, "orders.json");
const dataDir = path.join(__dirname, "data");
const itemsPath = path.join(dataDir, "items.json");
const usersPath = path.join(dataDir, "users.json");

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(itemsPath)) {
    fs.writeFileSync(itemsPath, "[]");
  }
  if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, "[]");
  }
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadOrders() {
  return readJson(ordersPath, []);
}

function saveOrders(orders) {
  writeJson(ordersPath, orders);
}

function createOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}

function updateOrder(orderId, updates) {
  const orders = loadOrders();
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) return null;
  orders[index] = { ...orders[index], ...updates };
  saveOrders(orders);
  return orders[index];
}

function getOrder(orderId) {
  const orders = loadOrders();
  return orders.find((order) => order.id === orderId) || null;
}

function loadItems() {
  ensureDataFiles();
  return readJson(itemsPath, []);
}

function saveItems(items) {
  ensureDataFiles();
  writeJson(itemsPath, items);
}

function listItems() {
  return loadItems();
}

function getItem(itemId) {
  const items = loadItems();
  return items.find((item) => item.id === itemId) || null;
}

function createItem(item) {
  const items = loadItems();
  items.push(item);
  saveItems(items);
  return item;
}

function updateItem(itemId, updates) {
  const items = loadItems();
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) return null;
  items[index] = { ...items[index], ...updates };
  saveItems(items);
  return items[index];
}

function deleteItem(itemId) {
  const items = loadItems();
  const nextItems = items.filter((item) => item.id !== itemId);
  if (nextItems.length === items.length) return false;
  saveItems(nextItems);
  return true;
}

function loadUsers() {
  ensureDataFiles();
  return readJson(usersPath, []);
}

function saveUsers(users) {
  ensureDataFiles();
  writeJson(usersPath, users);
}

function upsertUser(user) {
  const users = loadUsers();
  const index = users.findIndex((item) => item.telegramUserId === user.telegramUserId);
  if (index === -1) {
    users.push(user);
  } else {
    users[index] = { ...users[index], ...user };
  }
  saveUsers(users);
  return user;
}

function updateUser(telegramUserId, updates) {
  const users = loadUsers();
  const index = users.findIndex((item) => item.telegramUserId === telegramUserId);
  if (index === -1) return null;
  users[index] = { ...users[index], ...updates };
  saveUsers(users);
  return users[index];
}

function getUser(telegramUserId) {
  const users = loadUsers();
  return users.find((item) => item.telegramUserId === telegramUserId) || null;
}

module.exports = {
  loadOrders,
  saveOrders,
  createOrder,
  updateOrder,
  getOrder,
  loadItems,
  saveItems,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  loadUsers,
  saveUsers,
  upsertUser,
  updateUser,
  getUser,
};

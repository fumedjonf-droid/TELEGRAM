const fs = require("fs");
const path = require("path");

const ordersPath = path.join(__dirname, "orders.json");

function loadOrders() {
  try {
    const raw = fs.readFileSync(ordersPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
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

module.exports = {
  loadOrders,
  saveOrders,
  createOrder,
  updateOrder,
  getOrder,
};

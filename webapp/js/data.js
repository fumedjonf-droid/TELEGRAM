export const categories = [
  {
    id: "pubg",
    title: "PUBG",
    style: "category-pubg",
  },
  {
    id: "freefire",
    title: "Free Fire",
    style: "category-freefire",
  },
  {
    id: "steam",
    title: "Steam",
    style: "category-steam",
  },
];

const products = [
  {
    id: "pubg-uc-325",
    categoryId: "pubg",
    name: "325 UC",
    price: 499,
  },
  {
    id: "pubg-uc-810",
    categoryId: "pubg",
    name: "810 UC",
    price: 1090,
  },
  {
    id: "pubg-uc-1800",
    categoryId: "pubg",
    name: "1800 UC",
    price: 2190,
  },
  {
    id: "freefire-520",
    categoryId: "freefire",
    name: "Алмазы 520",
    price: 799,
  },
  {
    id: "freefire-1060",
    categoryId: "freefire",
    name: "Алмазы 1060",
    price: 1490,
  },
  {
    id: "freefire-2180",
    categoryId: "freefire",
    name: "Алмазы 2180",
    price: 2890,
  },
  {
    id: "steam-500",
    categoryId: "steam",
    name: "Steam Wallet 500 ₽",
    price: 560,
  },
  {
    id: "steam-1000",
    categoryId: "steam",
    name: "Steam Wallet 1000 ₽",
    price: 1090,
  },
  {
    id: "steam-2000",
    categoryId: "steam",
    name: "Steam Wallet 2000 ₽",
    price: 2090,
  },
];

export const getProductsByCategory = (categoryId) =>
  products.filter((product) => product.categoryId === categoryId);

export const findProduct = (productId) =>
  products.find((product) => product.id === productId);

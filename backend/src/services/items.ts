import { getDb, nowIso } from "../db/index.js";

export const getOrCreateCategory = (name: string): number => {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM categories WHERE name = ?")
    .get(name) as { id: number } | undefined;
  if (existing) {
    return existing.id;
  }
  const result = db
    .prepare("INSERT INTO categories (name, sort_order, is_active) VALUES (?, 0, 1)")
    .run(name);
  return Number(result.lastInsertRowid);
};

export const createItem = (payload: {
  name: string;
  price: number;
  description: string;
  categoryId: number | null;
  imageFileId: string | null;
}) => {
  const db = getDb();
  const now = nowIso();
  const result = db
    .prepare(
      "INSERT INTO items (name, description, price, category_id, image_file_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    )
    .run(payload.name, payload.description, payload.price, payload.categoryId, payload.imageFileId, now, now);
  return Number(result.lastInsertRowid);
};

export const updateItem = (id: number, payload: {
  name: string;
  price: number;
  description: string;
  categoryId: number | null;
  imageFileId: string | null;
}) => {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    "UPDATE items SET name = ?, description = ?, price = ?, category_id = ?, image_file_id = ?, updated_at = ? WHERE id = ?"
  ).run(payload.name, payload.description, payload.price, payload.categoryId, payload.imageFileId, now, id);
};

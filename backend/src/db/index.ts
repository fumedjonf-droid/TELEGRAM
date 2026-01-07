import Database from "better-sqlite3";
import { config } from "../config.js";
import { schemaSql } from "./schema.js";

export type Db = Database.Database;

let dbInstance: Db | null = null;

export const getDb = (): Db => {
  if (!dbInstance) {
    dbInstance = new Database(config.SQLITE_PATH);
    dbInstance.exec(schemaSql);
  }
  return dbInstance;
};

export const nowIso = (): string => new Date().toISOString();

import type { Table, Relation } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

export type TableInfo = {
  name: string;
  table: Table;
  columns: Record<string, SQLiteColumn>;
};

export type TableNamedRelations = {
  relation: Relation;
  targetTableName: string;
};

export type GeneratedSchema = {
  tables: Record<string, TableInfo>;
  relations: Record<string, Record<string, TableNamedRelations>>;
  typeDefs: string;
  queries: Record<string, any>;
  mutations: Record<string, any>;
};

export type WhereInput = Record<string, any>;
export type OrderByInput = Record<string, any>;
export type InsertInput = Record<string, any>;
export type UpdateInput = Record<string, any>;

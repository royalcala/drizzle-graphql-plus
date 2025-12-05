import { eq, and, or, SQL, Column } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { TableInfo } from "./types";
import { GraphQLError } from "graphql";
import {
  remapFromGraphQLSingleInput,
  remapFromGraphQLArrayInput,
} from "@/util/data-mappers";
import { capitalize } from "@/util/case-ops";

type ColumnFilters = {
  eq?: any;
  ne?: any;
  gt?: any;
  gte?: any;
  lt?: any;
  lte?: any;
  like?: string;
  notLike?: string;
  ilike?: string;
  notIlike?: string;
  inArray?: any[];
  notInArray?: any[];
  isNull?: boolean;
  isNotNull?: boolean;
  OR?: ColumnFilters[];
};

type WhereInput = Record<string, ColumnFilters> & {
  OR?: WhereInput[];
};
type InsertInput = Record<string, any>;
type UpdateInput = Record<string, any>;

const buildWhereClause = (tableInfo: TableInfo, where?: WhereInput) => {
  if (!where || Object.keys(where).length === 0) {
    return undefined;
  }

  // Handle table-level OR
  if (where.OR && where.OR.length > 0) {
    if (Object.keys(where).length > 1) {
      throw new GraphQLError(
        `WHERE ${tableInfo.name}: Cannot specify both fields and 'OR' in table filters!`
      );
    }

    const variants: any[] = [];

    for (const variant of where.OR) {
      const extracted = buildWhereClause(tableInfo, variant);
      if (extracted) variants.push(extracted);
    }

    return variants.length
      ? variants.length > 1
        ? or(...variants)
        : variants[0]
      : undefined;
  }

  const conditions: SQL[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") continue; // Skip OR field
    if (value === null || value === undefined) continue;

    const column = tableInfo.columns[key];
    if (column) {
      const filters = value as ColumnFilters;
      // Simple equality for mutations
      if (typeof filters === "object" && filters.eq !== undefined) {
        conditions.push(eq(column, filters.eq));
      } else if (typeof filters !== "object" || !Array.isArray(filters)) {
        // Direct value means eq
        conditions.push(eq(column, filters));
      }
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
};

export const generateMutations = (
  db: BaseSQLiteDatabase<any, any, any, any>,
  tables: Record<string, TableInfo>
) => {
  const mutations: Record<string, any> = {};

  for (const [tableName, tableInfo] of Object.entries(tables)) {
    const capitalizedName = capitalize(tableName);

    // Insert mutation
    mutations[`insert${capitalizedName}`] = async (
      parent: any,
      args: { values: InsertInput[] },
      context: any,
      info: any
    ) => {
      try {
        const { values } = args;

        if (!values || values.length === 0) {
          throw new GraphQLError("No values provided for insert");
        }

        // Remap input values
        const remappedValues = remapFromGraphQLArrayInput(
          values,
          tableInfo.table
        );

        // Insert and return the inserted rows
        const result = await db
          .insert(tableInfo.table)
          .values(remappedValues)
          .returning();

        return result;
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };

    // Update mutation
    mutations[`update${capitalizedName}`] = async (
      parent: any,
      args: { where?: WhereInput; set: UpdateInput },
      context: any,
      info: any
    ) => {
      try {
        const { where, set } = args;

        if (!set || Object.keys(set).length === 0) {
          throw new GraphQLError("No values provided for update");
        }

        // Remap input values
        const remappedSet = remapFromGraphQLSingleInput(set, tableInfo.table);

        const whereClause = buildWhereClause(tableInfo, where);

        let query = db.update(tableInfo.table).set(remappedSet);

        if (whereClause) {
          query = query.where(whereClause) as any;
        }

        // Execute update with RETURNING
        const result = await (query as any).returning();

        return result;
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };

    // Delete mutation
    mutations[`delete${capitalizedName}`] = async (
      parent: any,
      args: { where?: WhereInput },
      context: any,
      info: any
    ) => {
      try {
        const { where } = args;

        const whereClause = buildWhereClause(tableInfo, where);

        let deleteQuery = db.delete(tableInfo.table);

        if (whereClause) {
          deleteQuery = deleteQuery.where(whereClause) as any;
        }

        // Execute delete with RETURNING
        const result = await (deleteQuery as any).returning();

        return result;
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };
  }

  return mutations;
};

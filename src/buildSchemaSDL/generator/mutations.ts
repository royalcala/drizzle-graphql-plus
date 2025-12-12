import { eq, and, or, inArray, SQL, Column } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "./types";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import {
  remapFromGraphQLSingleInput,
  remapFromGraphQLArrayInput,
} from "@/util/data-mappers";
import { capitalize } from "@/util/case-ops";
import { createQueryResolver } from "./queries";

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

export type MutationResolvers = Record<
  string,
  (...args: any[]) => Promise<any>
>;

export const generateMutations = (
  db: BaseSQLiteDatabase<any, any, any, any>,
  tables: Record<string, TableInfo>,
  relations: Record<string, Record<string, TableNamedRelations>>
): MutationResolvers => {
  const mutations: MutationResolvers = {};

  for (const [tableName, tableInfo] of Object.entries(tables)) {
    const capitalizedName = capitalize(tableName);

    // Get the query base for relational queries
    const queryBase = db.query[
      tableName as keyof typeof db.query
    ] as unknown as RelationalQueryBuilder<any, any, any, any> | undefined;

    if (!queryBase) {
      throw new Error(
        `Drizzle-GraphQL Error: Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`
      );
    }

    // Find the primary key column (assumes it's named 'id' or has primaryKey)
    const primaryKeyColumn = Object.values(tableInfo.columns).find(
      (col: any) => col.primary || col.name === "id"
    );

    if (!primaryKeyColumn) {
      throw new Error(
        `Drizzle-GraphQL Error: Table ${tableName} does not have a primary key column`
      );
    }

    // Create a query resolver for this table
    const queryResolver = createQueryResolver(
      queryBase,
      tableInfo,
      tables,
      relations
    );

    // Insert mutation
    mutations[`${tableName}InsertMany`] = async (
      parent: any,
      args: { values: InsertInput[] },
      context: any,
      info: GraphQLResolveInfo
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
        const insertedRows = await db
          .insert(tableInfo.table)
          .values(remappedValues)
          .returning();

        // Extract IDs from inserted rows
        const insertedIds = insertedRows.map(
          (row: any) => row[primaryKeyColumn.name]
        );

        // Use the query resolver with where clause for the inserted IDs
        return queryResolver(
          parent,
          {
            where: {
              [primaryKeyColumn.name]: { inArray: insertedIds },
            },
          },
          context,
          info
        );
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };

    // Update mutation
    mutations[`${tableName}UpdateMany`] = async (
      parent: any,
      args: { where?: WhereInput; set: UpdateInput },
      context: any,
      info: GraphQLResolveInfo
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
        const updatedRows = await (query as any).returning();

        // Extract IDs from updated rows
        const updatedIds = updatedRows.map(
          (row: any) => row[primaryKeyColumn.name]
        );

        // Use the query resolver with where clause for the updated IDs
        return queryResolver(
          parent,
          {
            where: {
              [primaryKeyColumn.name]: { inArray: updatedIds },
            },
          },
          context,
          info
        );
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };

    // Delete mutation
    mutations[`${tableName}DeleteMany`] = async (
      parent: any,
      args: { where?: WhereInput },
      context: any,
      info: GraphQLResolveInfo
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

import {
  getTableColumns,
  eq,
  gt,
  gte,
  lt,
  lte,
  ne,
  inArray,
  notInArray,
  like,
  notLike,
  ilike,
  notIlike,
  isNull,
  isNotNull,
  and,
  or,
  asc,
  desc,
  SQL,
  Column,
} from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "./types";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { remapFromGraphQLCore } from "@/util/data-mappers";
import { parseResolveInfo, type ResolveTree } from "graphql-parse-resolve-info";
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

type OrderByField = {
  direction: "asc" | "desc";
  priority: number;
};

type OrderByInput = Record<string, OrderByField>;

// Extract filters for a single column (following the same pattern as common.ts)
const extractFiltersColumn = (
  column: Column,
  columnName: string,
  operators: ColumnFilters
): SQL | undefined => {
  const entries = Object.entries(operators);

  if (!entries.length) return undefined;

  // Handle OR operator
  if (operators.OR && operators.OR.length > 0) {
    if (entries.length > 1) {
      throw new GraphQLError(
        `WHERE ${columnName}: Cannot specify both fields and 'OR' in column operators!`
      );
    }

    const variants: SQL[] = [];

    for (const variant of operators.OR) {
      const extracted = extractFiltersColumn(column, columnName, variant);
      if (extracted) variants.push(extracted);
    }

    return variants.length
      ? variants.length > 1
        ? or(...variants)
        : variants[0]
      : undefined;
  }

  const variants: SQL[] = [];

  for (const [operatorName, operatorValue] of entries) {
    if (operatorValue === null || operatorValue === false) continue;

    switch (operatorName) {
      case "eq":
      case "ne":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const singleValue = remapFromGraphQLCore(
          operatorValue,
          column,
          columnName
        );
        const opMap = { eq, ne, gt, gte, lt, lte };
        variants.push(opMap[operatorName](column, singleValue));
        break;
      }

      case "like":
      case "notLike":
      case "ilike":
      case "notIlike": {
        const opMap = { like, notLike, ilike, notIlike };
        variants.push(opMap[operatorName](column, operatorValue as string));
        break;
      }

      case "inArray":
      case "notInArray": {
        if (!(operatorValue as any[]).length) {
          throw new GraphQLError(
            `WHERE ${columnName}: Unable to use operator ${operatorName} with an empty array!`
          );
        }
        const arrayValue = (operatorValue as any[]).map((val) =>
          remapFromGraphQLCore(val, column, columnName)
        );
        const opMap = { inArray, notInArray };
        variants.push(opMap[operatorName](column, arrayValue));
        break;
      }

      case "isNull":
      case "isNotNull": {
        const opMap = { isNull, isNotNull };
        variants.push(opMap[operatorName](column));
        break;
      }
    }
  }

  return variants.length
    ? variants.length > 1
      ? and(...variants)
      : variants[0]
    : undefined;
};

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

    const variants: SQL[] = [];

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

  for (const [columnName, operators] of Object.entries(where)) {
    if (columnName === "OR") continue; // Skip OR field
    if (!operators || Object.keys(operators).length === 0) continue;

    const column = tableInfo.columns[columnName];
    if (!column) continue;

    const extracted = extractFiltersColumn(
      column,
      columnName,
      operators as ColumnFilters
    );
    if (extracted) conditions.push(extracted);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
};

const buildOrderByClause = (tableInfo: TableInfo, orderBy?: OrderByInput) => {
  if (!orderBy || Object.keys(orderBy).length === 0) {
    return undefined;
  }

  // Convert to array and sort by priority
  const orderEntries = Object.entries(orderBy).map(([columnName, field]) => ({
    columnName,
    ...field,
  }));

  orderEntries.sort((a, b) => a.priority - b.priority);

  const orderClauses: SQL[] = [];

  for (const entry of orderEntries) {
    const column = tableInfo.columns[entry.columnName];
    if (column) {
      orderClauses.push(
        entry.direction === "desc" ? desc(column) : asc(column)
      );
    }
  }

  return orderClauses.length > 0 ? orderClauses : undefined;
};

// Extract selected columns from GraphQL resolve tree
const extractSelectedColumns = (
  fields: Record<string, ResolveTree>,
  tableInfo: TableInfo
): Record<string, boolean> => {
  const columns: Record<string, boolean> = {};

  for (const fieldName of Object.keys(fields)) {
    if (tableInfo.columns[fieldName]) {
      columns[fieldName] = true;
    }
  }

  return Object.keys(columns).length > 0 ? columns : {};
};

// Extract relations params recursively
const extractRelationsParams = (
  relationMap: Record<string, Record<string, TableNamedRelations>>,
  tables: Record<string, TableInfo>,
  tableName: string,
  fields: Record<string, ResolveTree>
): Record<string, any> | undefined => {
  const relations = relationMap[tableName];
  if (!relations) return undefined;

  const args: Record<string, any> = {};

  for (const [relName, { targetTableName, relation }] of Object.entries(
    relations
  )) {
    const relationField = fields[relName];
    if (!relationField) continue;

    // Collect fields from all types in fieldsByTypeName
    const allFields: Record<string, ResolveTree> = {};
    if (relationField.fieldsByTypeName) {
      for (const typeFields of Object.values(relationField.fieldsByTypeName)) {
        Object.assign(allFields, typeFields);
      }
    }

    const targetTable = tables[targetTableName];
    if (!targetTable) continue;

    const thisRecord: any = {
      columns: extractSelectedColumns(allFields, targetTable),
    };

    // Extract relation arguments
    const relationArgs = relationField.args as any;
    if (relationArgs) {
      if (relationArgs["where"]) {
        thisRecord.where = buildWhereClause(
          targetTable,
          relationArgs["where"] as WhereInput
        );
      }
      if (relationArgs["orderBy"]) {
        thisRecord.orderBy = buildOrderByClause(
          targetTable,
          relationArgs["orderBy"] as OrderByInput
        );
      }
      if (relationArgs["limit"] !== undefined) {
        thisRecord.limit = relationArgs["limit"];
      }
      if (relationArgs["offset"] !== undefined) {
        thisRecord.offset = relationArgs["offset"];
      }
    }

    // Recursively extract nested relations
    const nestedWith = extractRelationsParams(
      relationMap,
      tables,
      targetTableName,
      allFields
    );
    if (nestedWith) {
      thisRecord.with = nestedWith;
    }

    args[relName] = thisRecord;
  }

  return Object.keys(args).length > 0 ? args : undefined;
};

export type QueryResolvers = Record<string, (...args: any[]) => Promise<any>>;

export const generateQueries = (
  db: BaseSQLiteDatabase<any, any, any, any>,
  tables: Record<string, TableInfo>,
  relations: Record<string, Record<string, TableNamedRelations>>
): QueryResolvers => {
  const queries: QueryResolvers = {};

  for (const [tableName, tableInfo] of Object.entries(tables)) {
    const queryBase = db.query[
      tableName as keyof typeof db.query
    ] as unknown as RelationalQueryBuilder<any, any, any, any> | undefined;

    if (!queryBase) {
      throw new Error(
        `Drizzle-GraphQL Error: Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`
      );
    }

    // findMany query
    queries[tableName] = async (
      parent: any,
      args: {
        where?: WhereInput;
        orderBy?: OrderByInput;
        limit?: number;
        offset?: number;
      },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      try {
        const { where, orderBy, limit, offset } = args;

        // Parse GraphQL resolve info
        const parsedInfo = parseResolveInfo(info, {
          deep: true,
        }) as ResolveTree;

        // Collect fields from all types in fieldsByTypeName
        const allFields: Record<string, ResolveTree> = {};
        if (parsedInfo.fieldsByTypeName) {
          for (const fields of Object.values(parsedInfo.fieldsByTypeName)) {
            Object.assign(allFields, fields);
          }
        }

        const result = await queryBase.findMany({
          columns: extractSelectedColumns(allFields, tableInfo),
          offset,
          limit,
          orderBy: buildOrderByClause(tableInfo, orderBy),
          where: buildWhereClause(tableInfo, where),
          with: extractRelationsParams(relations, tables, tableName, allFields),
        });

        return result;
      } catch (e) {
        if (typeof e === "object" && e !== null && "message" in e) {
          throw new GraphQLError(String(e.message));
        }
        throw e;
      }
    };
  }

  return queries;
};

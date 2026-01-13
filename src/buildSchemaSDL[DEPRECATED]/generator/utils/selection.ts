import { asc, desc, SQL, Column } from "drizzle-orm";
import type { ResolveTree } from "graphql-parse-resolve-info";
import type { TableInfo, TableNamedRelations } from "../types";
import { buildWhereClause, type WhereInput } from "./filters";
import {
  resolveExportVariables,
  hasExportVariables,
} from "../../../export-directive[DEPRECATED]/utils";
import type { ExportStore } from "../../../export-directive[DEPRECATED]/ExportStore";

export type OrderByField = {
  direction: "asc" | "desc";
  priority: number;
};

export type OrderByInput = Record<string, OrderByField>;

export const buildOrderByClause = (
  tableInfo: TableInfo,
  orderBy?: OrderByInput
) => {
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
export const extractSelectedColumns = (
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
export const extractRelationsParams = async (
  relationMap: Record<string, Record<string, TableNamedRelations>>,
  tables: Record<string, TableInfo>,
  tableName: string,
  fields: Record<string, ResolveTree>,
  context?: any
): Promise<Record<string, any> | undefined> => {
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
        let whereClause = relationArgs["where"] as WhereInput;

        // Resolve export variables in nested relation where clauses
        if (context?.exportStore && hasExportVariables(whereClause)) {
          try {
            // Use async resolution to wait for export variables to become available
            whereClause = await resolveExportVariables(
              whereClause,
              context.exportStore
            );
          } catch (error) {
            // If resolution fails, log warning but continue with original clause
            console.warn(
              `Failed to resolve export variables in nested relation ${relName}:`,
              error
            );
          }
        }

        thisRecord.where = buildWhereClause(targetTable, whereClause);
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
    const nestedWith = await extractRelationsParams(
      relationMap,
      tables,
      targetTableName,
      allFields,
      context
    );
    if (nestedWith) {
      thisRecord.with = nestedWith;
    }

    args[relName] = thisRecord;
  }

  return Object.keys(args).length > 0 ? args : undefined;
};

// Synchronous version of resolveExportVariables for cases where exports should already be available
function resolveExportVariablesSync(args: any, exportStore: ExportStore): any {
  // Handle primitive export variables
  if (typeof args === "string" && args.startsWith("$_") && args.length > 2) {
    const varName = args.slice(2);
    const value = exportStore.get(varName);
    if (value === undefined) {
      throw new Error(`Export variable ${varName} not found`);
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(args)) {
    return args.map((item) => resolveExportVariablesSync(item, exportStore));
  }

  // Handle objects
  if (typeof args === "object" && args !== null) {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      resolved[key] = resolveExportVariablesSync(value, exportStore);
    }
    return resolved;
  }

  // Return primitive values as-is
  return args;
}

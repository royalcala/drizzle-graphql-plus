import {
    asc,
    desc,
    SQL,
    Column,
} from "drizzle-orm";
import type { ResolveTree } from "graphql-parse-resolve-info";
import type { TableInfo, TableNamedRelations } from "../types";
import { buildWhereClause, type WhereInput } from "./filters";

export type OrderByField = {
    direction: "asc" | "desc";
    priority: number;
};

export type OrderByInput = Record<string, OrderByField>;

export const buildOrderByClause = (tableInfo: TableInfo, orderBy?: OrderByInput) => {
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
export const extractRelationsParams = (
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

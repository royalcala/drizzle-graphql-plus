import {
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
    SQL,
    Column,
} from "drizzle-orm";
import { GraphQLError } from "graphql";
import { remapFromGraphQLCore } from "@/util/data-mappers";
import type { TableInfo } from "../types";

export type ColumnFilters = {
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

export type WhereInput = Record<string, ColumnFilters> & {
    OR?: WhereInput[];
};

// Extract filters for a single column
export const extractFiltersColumn = (
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
                variants.push(opMap[operatorName as keyof typeof opMap](column, singleValue));
                break;
            }

            case "like":
            case "notLike":
            case "ilike":
            case "notIlike": {
                const opMap = { like, notLike, ilike, notIlike };
                variants.push(opMap[operatorName as keyof typeof opMap](column, operatorValue as string));
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
                variants.push(opMap[operatorName as keyof typeof opMap](column, arrayValue));
                break;
            }

            case "isNull":
            case "isNotNull": {
                const opMap = { isNull, isNotNull };
                variants.push(opMap[operatorName as keyof typeof opMap](column));
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

export const buildWhereClause = (tableInfo: TableInfo, where?: WhereInput) => {
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

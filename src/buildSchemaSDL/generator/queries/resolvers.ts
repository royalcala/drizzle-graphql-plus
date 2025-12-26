import {
    RelationalQueryBuilder,
} from "drizzle-orm/sqlite-core/query-builders/query";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { parseResolveInfo, type ResolveTree } from "graphql-parse-resolve-info";

import type { TableInfo, TableNamedRelations } from "../types";
import {
    buildOrderByClause,
    extractSelectedColumns,
    extractRelationsParams,
    type OrderByInput,
} from "../utils/selection";
import { buildWhereClause, type WhereInput } from "../utils/filters";

// Shared query executor for findMany
export const createFindManyResolver = (
    queryBase: RelationalQueryBuilder<any, any, any, any>,
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>
) => {
    return async (
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
                with: extractRelationsParams(
                    relations,
                    tables,
                    tableInfo.name,
                    allFields
                ),
            });

            return result;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

// Query executor for findFirst that returns a single object
export const createFindFirstResolver = (
    queryBase: RelationalQueryBuilder<any, any, any, any>,
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>
) => {
    return async (
        parent: any,
        args: {
            where?: WhereInput;
            orderBy?: OrderByInput;
        },
        context: any,
        info: GraphQLResolveInfo
    ) => {
        try {
            const { where, orderBy } = args;

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

            const result = await queryBase.findFirst({
                columns: extractSelectedColumns(allFields, tableInfo),
                orderBy: buildOrderByClause(tableInfo, orderBy),
                where: buildWhereClause(tableInfo, where),
                with: extractRelationsParams(
                    relations,
                    tables,
                    tableInfo.name,
                    allFields
                ),
            });

            return result || null;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "../types";
import { createFindManyResolver, createFindFirstResolver } from "./resolvers";

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

        // resolver findMany query
        queries[`${tableName}FindMany`] = createFindManyResolver(
            queryBase,
            tableInfo,
            tables,
            relations
        );

        // resolver findFirst query
        queries[`${tableName}FindFirst`] = createFindFirstResolver(
            queryBase,
            tableInfo,
            tables,
            relations
        );
    }

    return queries;
};

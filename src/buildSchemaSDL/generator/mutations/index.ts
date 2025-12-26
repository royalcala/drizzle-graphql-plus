import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "../types";
import { capitalize } from "@/util/case-ops";
import {
    createInsertManyResolver,
    createUpdateManyResolver,
    createDeleteManyResolver,
} from "./resolvers";

export type MutationResolvers = Record<
    string,
    (...args: any[]) => Promise<any>
>;

export type DeleteResultResolvers = Record<string, Record<string, any>>;

export const generateMutations = (
    db: BaseSQLiteDatabase<any, any, any, any>,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>
): {
    mutations: MutationResolvers;
    deleteResultResolvers: DeleteResultResolvers;
} => {
    const mutations: MutationResolvers = {};
    const deleteResultResolvers: DeleteResultResolvers = {};

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

        // Insert mutation
        mutations[`${tableName}InsertMany`] = createInsertManyResolver(
            db,
            queryBase,
            tableInfo,
            tables,
            relations,
            primaryKeyColumn
        );

        // Update mutation
        mutations[`${tableName}UpdateMany`] = createUpdateManyResolver(
            db,
            queryBase,
            tableInfo,
            tables,
            relations,
            primaryKeyColumn
        );

        // Delete mutation
        mutations[`${tableName}DeleteMany`] = createDeleteManyResolver(
            db,
            queryBase,
            tableInfo,
            tables,
            relations,
            primaryKeyColumn
        );
    }

    return { mutations, deleteResultResolvers: {} };
};

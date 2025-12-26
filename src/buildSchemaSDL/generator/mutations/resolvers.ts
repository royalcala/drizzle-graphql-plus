import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "../types";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import {
    remapFromGraphQLSingleInput,
    remapFromGraphQLArrayInput,
} from "@/util/data-mappers";
import { createFindManyResolver } from "../queries/resolvers";
import { buildWhereClause, type WhereInput } from "../utils/filters";

type InsertInput = Record<string, any>;
type UpdateInput = Record<string, any>;

export const createInsertManyResolver = (
    db: BaseSQLiteDatabase<any, any, any, any>,
    queryBase: RelationalQueryBuilder<any, any, any, any>,
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>,
    primaryKeyColumn: any
) => {
    const queryResolver = createFindManyResolver(
        queryBase,
        tableInfo,
        tables,
        relations
    );

    return async (
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
            const result = await queryResolver(
                parent,
                {
                    where: {
                        [primaryKeyColumn.name]: { inArray: insertedIds },
                    },
                },
                context,
                info
            );

            return result;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

export const createUpdateManyResolver = (
    db: BaseSQLiteDatabase<any, any, any, any>,
    queryBase: RelationalQueryBuilder<any, any, any, any>,
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>,
    primaryKeyColumn: any
) => {
    const queryResolver = createFindManyResolver(
        queryBase,
        tableInfo,
        tables,
        relations
    );

    return async (
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
            const result = await queryResolver(
                parent,
                {
                    where: {
                        [primaryKeyColumn.name]: { inArray: updatedIds },
                    },
                },
                context,
                info
            );

            return result;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

export const createDeleteManyResolver = (
    db: BaseSQLiteDatabase<any, any, any, any>,
    queryBase: RelationalQueryBuilder<any, any, any, any>,
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>,
    primaryKeyColumn: any
) => {
    const queryResolver = createFindManyResolver(
        queryBase,
        tableInfo,
        tables,
        relations
    );

    return async (
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
            const deletedRows = await (deleteQuery as any).returning();

            // Extract IDs from deleted rows
            const deletedItems = deletedRows.map((row: any) => ({
                id: row[primaryKeyColumn.name],
            }));

            // Return object with deletedItems and query resolver
            return {
                deletedItems,
                [tableInfo.name + "FindMany"]: queryResolver,
            };
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

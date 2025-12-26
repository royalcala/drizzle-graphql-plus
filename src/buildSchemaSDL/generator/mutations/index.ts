import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type { TableInfo, TableNamedRelations } from "../types";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import {
    remapFromGraphQLSingleInput,
    remapFromGraphQLArrayInput,
} from "@/util/data-mappers";
import { capitalize } from "@/util/case-ops";
import { createFindManyResolver } from "../queries/resolvers";
import { buildWhereClause, type WhereInput } from "../utils/filters";

type InsertInput = Record<string, any>;
type UpdateInput = Record<string, any>;

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

        // Create a query resolver for this table
        const queryResolver = createFindManyResolver(
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
                const deletedRows = await (deleteQuery as any).returning();

                return deletedRows;
            } catch (e) {
                if (typeof e === "object" && e !== null && "message" in e) {
                    throw new GraphQLError(String((e as any).message));
                }
                throw e;
            }
        };
    }

    return { mutations, deleteResultResolvers: {} };
};

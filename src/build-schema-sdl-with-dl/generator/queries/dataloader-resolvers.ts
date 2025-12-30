import {
    RelationalQueryBuilder,
} from "drizzle-orm/sqlite-core/query-builders/query";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { parseResolveInfo, type ResolveTree } from "graphql-parse-resolve-info";
import { is, One } from "drizzle-orm";

import type { TableInfo, TableNamedRelations } from "../types";
import {
    buildOrderByClause,
    extractSelectedColumns,
    type OrderByInput,
} from "../utils/selection";
import { buildWhereClause, type WhereInput } from "../utils/filters";
import {
    getRelationLoader,
    type DataLoaderContext,
} from "../utils/dataloader";

// Enhanced resolver that uses DataLoader for relations
export const createDataLoaderFindManyResolver = (
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
        context: DataLoaderContext,
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

            // Always select ALL columns - let GraphQL handle field selection
            // This ensures foreign keys are always available for relations
            const allColumns: Record<string, boolean> = {};
            for (const columnName of Object.keys(tableInfo.columns)) {
                allColumns[columnName] = true;
            }

            // First, fetch the main entities WITHOUT relations
            const mainResults = await queryBase.findMany({
                columns: allColumns,
                offset,
                limit,
                orderBy: buildOrderByClause(tableInfo, orderBy),
                where: buildWhereClause(tableInfo, where),
                // No 'with' clause - we'll load relations separately
            });

            // If no results or no relations requested, return early
            if (mainResults.length === 0) {
                return mainResults;
            }

            // Load relations using DataLoader
            const enhancedResults = await loadRelationsWithDataLoader(
                mainResults,
                tableInfo,
                tables,
                relations,
                allFields,
                context
            );

            return enhancedResults;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

// Enhanced resolver for findFirst
export const createDataLoaderFindFirstResolver = (
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
        context: DataLoaderContext,
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

            // Always select ALL columns - let GraphQL handle field selection
            // This ensures foreign keys are always available for relations
            const allColumns: Record<string, boolean> = {};
            for (const columnName of Object.keys(tableInfo.columns)) {
                allColumns[columnName] = true;
            }

            // Fetch the main entity WITHOUT relations
            const mainResult = await queryBase.findFirst({
                columns: allColumns,
                orderBy: buildOrderByClause(tableInfo, orderBy),
                where: buildWhereClause(tableInfo, where),
                // No 'with' clause
            });

            if (!mainResult) {
                return null;
            }

            // Load relations using DataLoader
            const [enhancedResult] = await loadRelationsWithDataLoader(
                [mainResult],
                tableInfo,
                tables,
                relations,
                allFields,
                context
            );

            return enhancedResult || null;
        } catch (e) {
            if (typeof e === "object" && e !== null && "message" in e) {
                throw new GraphQLError(String((e as any).message));
            }
            throw e;
        }
    };
};

// Helper function to load relations using DataLoader
async function loadRelationsWithDataLoader(
    mainResults: any[],
    tableInfo: TableInfo,
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>,
    fields: Record<string, ResolveTree>,
    context: DataLoaderContext
): Promise<any[]> {
    const tableRelations = relations[tableInfo.name];
    if (!tableRelations) {
        return mainResults;
    }

    // Extract primary key values for batching
    const primaryKeyColumn = Object.values(tableInfo.columns).find(col => (col as any).primary);
    if (!primaryKeyColumn) {
        throw new Error(`No primary key found for table ${tableInfo.name}`);
    }

    const parentIds = mainResults.map(result => result[(primaryKeyColumn as any).name]);

    // Process each relation field
    const relationPromises: Promise<void>[] = [];

    for (const [relName, { targetTableName, relation }] of Object.entries(tableRelations)) {
        const relationField = fields[relName];
        if (!relationField) continue;

        const targetTable = tables[targetTableName];
        if (!targetTable) continue;

        // Collect fields from relation
        const relationFields: Record<string, ResolveTree> = {};
        if (relationField.fieldsByTypeName) {
            for (const typeFields of Object.values(relationField.fieldsByTypeName)) {
                Object.assign(relationFields, typeFields);
            }
        }

        // Always select ALL columns for relations - let GraphQL handle field selection
        const allTargetColumns: Record<string, boolean> = {};
        for (const columnName of Object.keys(targetTable.columns)) {
            allTargetColumns[columnName] = true;
        }

        // Extract relation arguments
        const relationArgs = relationField.args as any;
        const relationOptions = {
            columns: allTargetColumns,
            where: relationArgs?.where as WhereInput,
            orderBy: relationArgs?.orderBy as OrderByInput,
            limit: relationArgs?.limit as number,
            offset: relationArgs?.offset as number,
        };

        // Determine foreign key relationship
        let foreignKeyName: string;
        let isReversedRelation = false;

        // Get relation configuration
        const relationConfig = (relation as any).config;

        console.log(`Processing relation ${relName} for table ${tableInfo.name} -> ${targetTableName}`);

        if (relationConfig?.fields && relationConfig.fields.length > 0) {
            // This is a relation where we specify both fields and references
            // fields = columns in current table, references = columns in target table

            if (is(relation, One)) {
                // For one-to-one relations, check the direction
                // If fields is in current table and references is in target table,
                // we need to get the foreign key values from current records and find target records
                const fieldColumn = relationConfig.fields[0];
                const referenceColumn = relationConfig.references[0];

                // Find the TypeScript property name for the reference column in target table
                const referenceKeyName = Object.keys(targetTable.columns).find(key =>
                    targetTable.columns[key] === referenceColumn
                ) || referenceColumn.name;

                foreignKeyName = referenceKeyName; // We'll query target table by this key
                isReversedRelation = false; // We're querying target table by its primary key
                console.log(`One-to-one relation: foreignKey=${foreignKeyName}, isReversed=${isReversedRelation}`);
            } else {
                // For many-to-one relations like post.author
                const fieldColumn = relationConfig.fields[0];
                const referenceColumn = relationConfig.references[0];

                // Find the TypeScript property name for the reference column in target table
                foreignKeyName = Object.keys(targetTable.columns).find(key =>
                    targetTable.columns[key] === referenceColumn
                ) || referenceColumn.name;

                isReversedRelation = false; // We're querying target table by its primary key
                console.log(`Many-to-one relation: foreignKey=${foreignKeyName}, isReversed=${isReversedRelation}`);
            }
        } else if (relationConfig?.references && relationConfig.references.length > 0) {
            // This shouldn't happen in normal Drizzle relations, but handle it just in case
            foreignKeyName = relationConfig.references[0].name;
            isReversedRelation = true;
            console.log(`References-only relation: foreignKey=${foreignKeyName}, isReversed=${isReversedRelation}`);
        } else {
            // Inferred relation - need to find the foreign key
            // For one-to-many relations like user.posts, look for authorId in post table
            // For one-to-one relations, it depends on the direction

            if (is(relation, One)) {
                // For one-to-one, try to find a foreign key in target table that references current table
                let possibleForeignKeys = Object.entries(targetTable.columns).filter(([name, col]) => {
                    const lowerName = name.toLowerCase();
                    const tableName = tableInfo.name.toLowerCase();
                    return lowerName.endsWith('id') &&
                        (lowerName.includes(tableName) ||
                            lowerName === `${tableName}id` ||
                            lowerName === `${tableName}_id`);
                });

                if (possibleForeignKeys.length > 0) {
                    foreignKeyName = possibleForeignKeys[0][0];
                    isReversedRelation = true;
                } else {
                    // Try to find foreign key in current table
                    possibleForeignKeys = Object.entries(tableInfo.columns).filter(([name, col]) => {
                        const lowerName = name.toLowerCase();
                        const targetName = targetTableName.toLowerCase();
                        return lowerName.endsWith('id') &&
                            (lowerName.includes(targetName) ||
                                lowerName === `${targetName}id` ||
                                lowerName === `${targetName}_id`);
                    });

                    if (possibleForeignKeys.length > 0) {
                        foreignKeyName = possibleForeignKeys[0][0];
                        isReversedRelation = false;
                    } else {
                        console.warn(`Could not determine foreign key for one-to-one relation ${relName}`);
                        console.warn(`Available columns in current table ${tableInfo.name}:`, Object.keys(tableInfo.columns));
                        console.warn(`Available columns in target table ${targetTableName}:`, Object.keys(targetTable.columns));
                        continue;
                    }
                }
            } else {
                // For one-to-many relations, foreign key is typically in target table
                // Look for a column that references the current table
                // First try exact match patterns
                let possibleForeignKeys = Object.entries(targetTable.columns).filter(([name, col]) => {
                    const lowerName = name.toLowerCase();
                    const tableName = tableInfo.name.toLowerCase();
                    // Try common patterns: authorId, userId, etc.
                    return (lowerName.endsWith('id') &&
                        (lowerName.includes(tableName) ||
                            lowerName === `${tableName}id` ||
                            lowerName === `${tableName}_id` ||
                            // Special case for author -> user relationship
                            (tableName === 'user' && lowerName === 'authorid') ||
                            (tableName === 'user' && lowerName === 'author_id')));
                });

                if (possibleForeignKeys.length > 0) {
                    foreignKeyName = possibleForeignKeys[0][0];
                    isReversedRelation = true;
                } else {
                    console.warn(`Could not determine foreign key for one-to-many relation ${relName}. Looking for foreign key in target table ${targetTableName} that references ${tableInfo.name}`);
                    console.warn(`Available columns in ${targetTableName}:`, Object.keys(targetTable.columns));
                    continue;
                }
            }
        }

        // For many-to-one relations, we need to extract the foreign key values from the main results
        let actualParentIds = parentIds;
        if (relationConfig?.fields && relationConfig.fields.length > 0) {
            // Check if this is a many-to-one relation (post.author) vs one-to-one relation (user.profile)
            // Many-to-one: foreign key is in current table, we query target table by primary key
            // One-to-one: foreign key is in target table, we query target table by foreign key

            const fieldColumn = relationConfig.fields[0];
            const fieldKeyName = Object.keys(tableInfo.columns).find(key =>
                tableInfo.columns[key] === fieldColumn
            ) || fieldColumn.name;

            // Check if the field exists in the current table (many-to-one) vs target table (one-to-one)
            if (tableInfo.columns[fieldKeyName]) {
                // Many-to-one relation: extract foreign key values from main results
                actualParentIds = mainResults.map(result => result[fieldKeyName]).filter(id => id != null);
                console.log(`Extracted foreign key values for many-to-one relation:`, actualParentIds);
            }
        }

        // Get the relation loader for the target table
        const targetQueryBase = (context as any).db?.query?.[targetTableName];
        if (!targetQueryBase) {
            console.warn(`No query base found for target table ${targetTableName}`);
            continue;
        }

        const relationLoader = getRelationLoader(
            context,
            targetTableName,
            targetQueryBase,
            targetTable,
            relations[targetTableName] || {}
        );

        console.log(`Created relation loader for ${targetTableName}, calling loadRelation with parentIds:`, actualParentIds);

        // Load relation data
        const relationPromise = relationLoader.loadRelation(
            relName,
            actualParentIds,
            foreignKeyName,
            relationOptions,
            isReversedRelation
        ).then(async (relationResults) => {
            console.log(`Relation ${relName} loaded, got ${relationResults.length} results:`, relationResults);
            // Create a map for quick lookup
            const relationMap = new Map<any, any[]>();
            for (const result of relationResults) {
                relationMap.set(result.parentId, result.data);
            }

            // If there are nested relations, load them recursively
            const hasNestedRelations = Object.keys(relationFields).some(
                fieldName => !targetTable.columns[fieldName]
            );

            if (hasNestedRelations && relationResults.some(r => r.data.length > 0)) {
                // Collect all relation data for nested loading
                const allRelationData = relationResults.flatMap(r => r.data);

                const enhancedRelationData = await loadRelationsWithDataLoader(
                    allRelationData,
                    targetTable,
                    tables,
                    relations,
                    relationFields,
                    context
                );

                // Rebuild the relation map with enhanced data
                let dataIndex = 0;
                for (const result of relationResults) {
                    const enhancedData = enhancedRelationData.slice(dataIndex, dataIndex + result.data.length);
                    relationMap.set(result.parentId, enhancedData);
                    dataIndex += result.data.length;
                }
            }

            // Attach relation data to main results
            for (const mainResult of mainResults) {
                const parentId = mainResult[(primaryKeyColumn as any).name];

                // Check if we extracted foreign key values (many-to-one relation)
                if (relationConfig?.fields && relationConfig.fields.length > 0) {
                    const fieldColumn = relationConfig.fields[0];
                    const fieldKeyName = Object.keys(tableInfo.columns).find(key =>
                        tableInfo.columns[key] === fieldColumn
                    ) || fieldColumn.name;

                    if (tableInfo.columns[fieldKeyName]) {
                        // Many-to-one relation: find the result by the foreign key value
                        const foreignKeyValue = mainResult[fieldKeyName];
                        const relationData = relationMap.get(foreignKeyValue) || [];

                        // For many-to-one relations, return single object or null
                        mainResult[relName] = relationData[0] || null;
                        continue;
                    }
                }

                // One-to-many and one-to-one relations: use the parent ID
                const relationData = relationMap.get(parentId) || [];

                // For one-to-one relations, return single object or null
                if (is(relation, One)) {
                    mainResult[relName] = relationData[0] || null;
                } else {
                    // For one-to-many relations, return array (never null)
                    mainResult[relName] = relationData;
                }
            }
        });

        relationPromises.push(relationPromise);
    }

    // Wait for all relations to load
    await Promise.all(relationPromises);

    return mainResults;
}
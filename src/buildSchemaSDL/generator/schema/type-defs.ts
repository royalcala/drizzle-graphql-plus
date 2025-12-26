import {
    Column,
    is,
    One,
} from "drizzle-orm";
import { MySqlInt, MySqlSerial } from "drizzle-orm/mysql-core";
import { PgInteger, PgSerial } from "drizzle-orm/pg-core";
import { SQLiteInteger } from "drizzle-orm/sqlite-core";
import { capitalize } from "@/util/case-ops";
import type { TableInfo, TableNamedRelations } from "../types";

const allowedNameChars = /^[a-zA-Z0-9_]+$/;

// Track custom scalars and enums that need to be defined
const customScalars = new Set<string>();
const enumDefinitions = new Map<string, { name: string; values: string[] }>();
const requiredFieldFilters = new Set<string>(); // Track which field filter types we need
const foreignKeyTypes = new Map<string, string>(); // Track inferred types for foreign keys: "tableName.columnName" -> "ULID"

// Convert Drizzle column to SDL type string
const columnToSDL = (
    column: Column,
    columnName: string,
    tableName: string,
    forceNullable = false
): string => {
    let baseType: string;

    // First check if column has customGraphqlType property (works for any dataType)
    // This takes precedence over all other type mappings
    if ((column as any).customGraphqlType) {
        baseType = (column as any).customGraphqlType;
        // Don't add to customScalars - user will define it themselves
    } else {
        // Check if this is a foreign key with an inferred type
        const foreignKeyType = foreignKeyTypes.get(`${tableName}.${columnName}`);
        if (foreignKeyType) {
            baseType = foreignKeyType;
            // Don't add to customScalars - will be defined by user
        } else {
            switch (column.dataType) {
                case "boolean":
                    baseType = "Boolean";
                    break;

                case "json":
                    if (column.columnType === "PgGeometryObject") {
                        baseType = "PgGeometryObject";
                        customScalars.add("PgGeometryObject");
                    } else {
                        baseType = "JSON";
                        customScalars.add("JSON");
                    }
                    break;

                case "date":
                    baseType = "Date";
                    customScalars.add("Date");
                    break;

                case "string":
                    if (column.enumValues?.length) {
                        const enumName = `${capitalize(tableName)}${capitalize(
                            columnName
                        )}Enum`;
                        baseType = enumName;

                        // Store enum definition
                        if (!enumDefinitions.has(enumName)) {
                            enumDefinitions.set(enumName, {
                                name: enumName,
                                values: column.enumValues.map((e, index) =>
                                    allowedNameChars.test(e) ? e : `Option${index}`
                                ),
                            });
                        }
                    } else {
                        baseType = "String";
                    }
                    break;

                case "bigint":
                    baseType = "BigInt";
                    customScalars.add("BigInt");
                    break;

                case "number":
                    if (
                        is(column, PgInteger) ||
                        is(column, PgSerial) ||
                        is(column, MySqlInt) ||
                        is(column, MySqlSerial) ||
                        is(column, SQLiteInteger)
                    ) {
                        baseType = "Int";
                    } else {
                        baseType = "Float";
                    }
                    break;

                case "buffer":
                    baseType = "[Int!]";
                    break;

                case "array":
                    if (column.columnType === "PgVector") {
                        baseType = "[Float!]";
                    } else if (column.columnType === "PgGeometry") {
                        baseType = "[Float!]";
                    } else {
                        // For generic arrays, we'll use a custom scalar
                        const scalarName = `${capitalize(tableName)}${capitalize(
                            columnName
                        )}Array`;
                        baseType = scalarName;
                        customScalars.add(scalarName);
                    }
                    break;

                case "custom":
                default:
                    // For custom types, use the column type name or generate one from the column name
                    // The columnType is the name given when calling customType()
                    if (column.columnType) {
                        baseType = column.columnType;
                        customScalars.add(column.columnType);
                    } else {
                        // Fallback: create a scalar name from table and column names
                        const customScalarName = `${capitalize(tableName)}${capitalize(
                            columnName
                        )}`;
                        baseType = customScalarName;
                        customScalars.add(customScalarName);
                    }
                    break;
            }
        }
    }

    // Apply non-null wrapper if needed
    // Note: hasDefault and defaultFn don't affect nullability of the field itself,
    // only whether it's required in InsertInput
    if (!forceNullable && column.notNull) {
        return `${baseType}!`;
    }

    return baseType;
};

export const generateTypeDefs = (
    tables: Record<string, TableInfo>,
    relations: Record<string, Record<string, TableNamedRelations>>
): string => {
    const typeDefs: string[] = [];

    // Reset global tracking
    customScalars.clear();
    enumDefinitions.clear();
    requiredFieldFilters.clear();
    foreignKeyTypes.clear();

    // First pass: Auto-infer foreign key types from relations
    // If a foreign key references another table's id, copy the id's custom type
    for (const [tableName, tableRelations] of Object.entries(relations)) {
        const tableInfo = tables[tableName];
        if (!tableInfo) continue;

        for (const [relationName, relationInfo] of Object.entries(tableRelations)) {
            const relation = relationInfo.relation;

            // Only process "one" relations (foreign keys)
            if (!is(relation, One)) continue;

            const config = relation.config;
            if (!config?.fields || !config?.references) continue;

            // Get the referenced table
            const referencedTableName = relationInfo.targetTableName;
            const referencedTable = tables[referencedTableName];
            if (!referencedTable) continue;

            // For each field-reference pair
            for (let i = 0; i < config.fields.length; i++) {
                const field = config.fields[i];
                const reference = config.references[i];

                if (!field || !reference) continue;

                // Get the actual column name (database name) from the field
                const fieldColumnName = (field as any).name;
                const referenceColumnName = (reference as any).name;

                // Find the column by its database name, not the JS property name
                const foreignKeyColumn = Object.values(tableInfo.columns).find(
                    (col: any) => col.name === fieldColumnName
                );
                const referencedColumn = Object.values(referencedTable.columns).find(
                    (col: any) => col.name === referenceColumnName
                );

                if (!foreignKeyColumn || !referencedColumn) continue;

                // Get the JS property name for the foreign key column
                const foreignKeyPropertyName = Object.keys(tableInfo.columns).find(
                    (key) => tableInfo.columns[key] === foreignKeyColumn
                );

                if (!foreignKeyPropertyName) continue;

                // If the referenced column has a custom type and the foreign key doesn't already have one
                const referencedCustomType = (referencedColumn as any)
                    .customGraphqlType;
                const foreignKeyHasCustomType = !!(foreignKeyColumn as any)
                    .customGraphqlType;

                if (referencedCustomType && !foreignKeyHasCustomType) {
                    // Store the mapping using the JS property name
                    foreignKeyTypes.set(
                        `${tableName}.${foreignKeyPropertyName}`,
                        referencedCustomType
                    );
                }
            }
        }
    }

    for (const [tableName, tableInfo] of Object.entries(tables)) {
        const typeName = capitalize(tableName);
        const fields: string[] = [];

        // Generate type fields from columns
        for (const [columnName, column] of Object.entries(tableInfo.columns)) {
            const typeStr = columnToSDL(
                column as Column,
                columnName,
                tableName,
                false
            );

            // Check for custom description
            const description = (column as any).customGraphqlDescription;
            if (description) {
                fields.push(`  """${description}"""`);
            }

            fields.push(`  ${columnName}: ${typeStr}`);
        }

        // Add relation fields with arguments
        const tableRelations = relations[tableName];
        if (tableRelations) {
            for (const [relationName, relationInfo] of Object.entries(
                tableRelations
            )) {
                const isOne = is(relationInfo.relation, One);
                const targetTableName = relationInfo.targetTableName;
                const targetTypeName = capitalize(targetTableName);

                if (isOne) {
                    // One-to-one or many-to-one: single object with where argument
                    // Note: Relations with where filters are always nullable because
                    // the filter might not match any records, even if the foreign key is NOT NULL
                    fields.push(
                        `  ${relationName}(where: ${targetTypeName}Filters): ${targetTypeName}`
                    );
                } else {
                    // One-to-many: array with where, orderBy, limit, offset
                    fields.push(
                        `  ${relationName}(where: ${targetTypeName}Filters, orderBy: ${targetTypeName}OrderBy, limit: Int, offset: Int): [${targetTypeName}!]!`
                    );
                }
            }
        }

        typeDefs.push(`type ${typeName} {\n${fields.join("\n")}\n}`);

        // Generate insert input type
        const insertFields: string[] = [];
        for (const [columnName, column] of Object.entries(tableInfo.columns)) {
            const typeStr = columnToSDL(
                column as Column,
                columnName,
                tableName,
                false
            );
            // Make nullable for insert (remove ! if present)
            // Columns with defaults or auto-increment are optional
            const nullableType = typeStr.endsWith("!")
                ? typeStr.slice(0, -1)
                : typeStr;
            insertFields.push(`  ${columnName}: ${nullableType}`);
        }

        if (insertFields.length > 0) {
            typeDefs.push(
                `input ${typeName}InsertInput {\n${insertFields.join("\n")}\n}`
            );
        }

        // Generate update input type (all fields optional)
        const updateFields: string[] = [];
        for (const [columnName, column] of Object.entries(tableInfo.columns)) {
            const typeStr = columnToSDL(
                column as Column,
                columnName,
                tableName,
                true
            );
            updateFields.push(`  ${columnName}: ${typeStr}`);
        }
        typeDefs.push(
            `input ${typeName}UpdateInput {\n${updateFields.join("\n")}\n}`
        );

        // Generate where input type (columns reference their types directly with operators)
        const whereFields: string[] = [];
        for (const [columnName, column] of Object.entries(tableInfo.columns)) {
            const typeStr = columnToSDL(
                column as Column,
                columnName,
                tableName,
                true
            );

            // Create a normalized type name for the filter
            const normalizedType = typeStr.replace(/[^a-zA-Z0-9]/g, "");
            const filterTypeName = `${normalizedType}FieldFilter`;

            // Track that we need this filter type
            requiredFieldFilters.add(
                JSON.stringify({ normalizedType, baseType: typeStr })
            );

            whereFields.push(`  ${columnName}: ${filterTypeName}`);
        }

        // Add table-level OR field
        whereFields.push(`  OR: [${typeName}Filters!]`);

        typeDefs.push(`input ${typeName}Filters {\n${whereFields.join("\n")}\n}`);

        // Generate order by input type (using shared InnerOrder)
        const orderByFields: string[] = [];
        for (const columnName of Object.keys(tableInfo.columns)) {
            orderByFields.push(`  ${columnName}: InnerOrder`);
        }

        typeDefs.push(`input ${typeName}OrderBy {\n${orderByFields.join("\n")}\n}`);

        // Generate DeleteResult type with deletedItems and query resolver
        typeDefs.push(`type ${typeName}DeleteResult {
  deletedItems: [DeletedItem!]!
  ${tableName}FindMany(where: ${typeName}Filters, orderBy: ${typeName}OrderBy, limit: Int, offset: Int): [${typeName}!]!
}`);
    }

    // Build final SDL with all definitions
    const allDefs: string[] = [];

    // Add custom scalars
    if (customScalars.size > 0) {
        for (const scalarName of Array.from(customScalars).sort()) {
            allDefs.push(`scalar ${scalarName}`);
        }
    }

    // Add enums
    if (enumDefinitions.size > 0) {
        for (const enumDef of enumDefinitions.values()) {
            const valueStrings = enumDef.values.map((v) => `  ${v}`);
            allDefs.push(`enum ${enumDef.name} {\n${valueStrings.join("\n")}\n}`);
        }
    }

    // Add OrderByDirection enum
    allDefs.push(`enum OrderByDirection {
  asc
  desc
}`);

    // Add shared DeletedItem type (used by all delete mutations)
    allDefs.push(`type DeletedItem {
  id: ID!
}`);

    // Add InnerOrder input (shared by all tables)
    allDefs.push(`input InnerOrder {
  direction: OrderByDirection!
  priority: Int!
}`);

    // Add generic field filter types (one per unique base type)
    const filterTypesAdded = new Set<string>();
    for (const filterInfoJson of requiredFieldFilters) {
        const { normalizedType, baseType } = JSON.parse(filterInfoJson);
        const filterTypeName = `${normalizedType}FieldFilter`;

        if (filterTypesAdded.has(filterTypeName)) continue;
        filterTypesAdded.add(filterTypeName);

        const filterFields: string[] = [];
        filterFields.push(`  eq: ${baseType}`);
        filterFields.push(`  ne: ${baseType}`);
        filterFields.push(`  lt: ${baseType}`);
        filterFields.push(`  lte: ${baseType}`);
        filterFields.push(`  gt: ${baseType}`);
        filterFields.push(`  gte: ${baseType}`);
        filterFields.push(`  like: String`);
        filterFields.push(`  notLike: String`);
        filterFields.push(`  ilike: String`);
        filterFields.push(`  notIlike: String`);
        filterFields.push(`  inArray: [${baseType}!]`);
        filterFields.push(`  notInArray: [${baseType}!]`);
        filterFields.push(`  isNull: Boolean`);
        filterFields.push(`  isNotNull: Boolean`);
        filterFields.push(`  OR: [${filterTypeName}!]`);

        allDefs.push(`input ${filterTypeName} {\n${filterFields.join("\n")}\n}`);
    }

    // Add type definitions
    allDefs.push(...typeDefs);

    return allDefs.join("\n\n");
};

export const generateQueryTypeDefs = (
    tables: Record<string, TableInfo>
): string => {
    const queryFields: string[] = [];

    for (const tableName of Object.keys(tables)) {
        const typeName = capitalize(tableName);

        // findMany query
        queryFields.push(
            `  ${tableName}FindMany(where: ${typeName}Filters, orderBy: ${typeName}OrderBy, limit: Int, offset: Int): [${typeName}!]!`
        );

        // findFirst query
        queryFields.push(
            `  ${tableName}FindFirst(where: ${typeName}Filters, orderBy: ${typeName}OrderBy): ${typeName}`
        );
    }

    return `type Query {\n${queryFields.join("\n")}\n}`;
};

export const generateMutationTypeDefs = (
    tables: Record<string, TableInfo>
): string => {
    const mutationFields: string[] = [];

    for (const tableName of Object.keys(tables)) {
        const typeName = capitalize(tableName);

        // insert mutation
        mutationFields.push(
            `  ${tableName}InsertMany(values: [${typeName}InsertInput!]!): [${typeName}!]!`
        );

        // update mutation
        mutationFields.push(
            `  ${tableName}UpdateMany(where: ${typeName}Filters, set: ${typeName}UpdateInput!): [${typeName}!]!`
        );

        // delete mutation - returns DeleteResult type
        mutationFields.push(
            `  ${tableName}DeleteMany(where: ${typeName}Filters): ${typeName}DeleteResult!`
        );
    }

    return `type Mutation {\n${mutationFields.join("\n")}\n}`;
};

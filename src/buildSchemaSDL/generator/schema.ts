import {
  getTableColumns,
  getTableName,
  Table,
  Column,
  is,
  Relations,
  Relation,
  createTableRelationsHelpers,
  One,
} from "drizzle-orm";
import { MySqlInt, MySqlSerial } from "drizzle-orm/mysql-core";
import { PgInteger, PgSerial } from "drizzle-orm/pg-core";
import { SQLiteInteger, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core";
import { capitalize } from "@/util/case-ops";
import type { TableInfo, TableNamedRelations } from "./types";

const allowedNameChars = /^[a-zA-Z0-9_]+$/;

// Track custom scalars and enums that need to be defined
const customScalars = new Set<string>();
const enumDefinitions = new Map<string, { name: string; values: string[] }>();

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

  // Apply non-null wrapper if needed
  if (
    !forceNullable &&
    column.notNull &&
    !column.hasDefault &&
    !column.defaultFn
  ) {
    return `${baseType}!`;
  }

  return baseType;
};

export const generateTypes = (
  db: BaseSQLiteDatabase<any, any, any, any>,
  schema: Record<string, unknown>
): {
  tables: Record<string, TableInfo>;
  relations: Record<string, Record<string, TableNamedRelations>>;
} => {
  const tables: Record<string, TableInfo> = {};
  const schemaEntries = Object.entries(schema);

  // Collect all tables from schema
  const tableEntries: [string, Table][] = [];
  for (const [key, value] of schemaEntries) {
    if (value && typeof value === "object" && "getSQL" in value) {
      const table = value as Table;
      const tableName = getTableName(table);
      const columns = getTableColumns(table);

      tables[tableName] = {
        name: tableName,
        table,
        columns: columns as Record<string, SQLiteColumn>,
      };
      tableEntries.push([tableName, table]);
    }
  }

  // Collect relations
  const rawRelations = schemaEntries
    .filter(([key, value]) => is(value, Relations))
    .map<[string, Relations]>(([key, value]) => [
      tableEntries.find(
        ([tableName, tableValue]) => tableValue === (value as Relations).table
      )![0] as string,
      value as Relations,
    ])
    .map<[string, Record<string, Relation>]>(([tableName, relValue]) => [
      tableName,
      relValue.config(createTableRelationsHelpers(tables[tableName]!.table)),
    ]);

  const namedRelations = Object.fromEntries(
    rawRelations.map(([relName, config]) => {
      const namedConfig: Record<string, TableNamedRelations> =
        Object.fromEntries(
          Object.entries(config).map(([innerRelName, innerRelValue]) => [
            innerRelName,
            {
              relation: innerRelValue,
              targetTableName: tableEntries.find(
                ([tableName, tableValue]) =>
                  tableValue === innerRelValue.referencedTable
              )![0],
            },
          ])
        );

      return [relName, namedConfig];
    })
  );

  return { tables, relations: namedRelations };
};

export const generateTypeDefs = (
  tables: Record<string, TableInfo>,
  relations: Record<string, Record<string, TableNamedRelations>>
): string => {
  const typeDefs: string[] = [];

  // Reset global tracking
  customScalars.clear();
  enumDefinitions.clear();

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

    // Generate column filter types (like the existing implementation)
    for (const [columnName, column] of Object.entries(tableInfo.columns)) {
      const typeStr = columnToSDL(
        column as Column,
        columnName,
        tableName,
        true
      );
      const filterName = `${typeName}${capitalize(columnName)}Filters`;

      const filterFields: string[] = [];
      filterFields.push(`  eq: ${typeStr}`);
      filterFields.push(`  ne: ${typeStr}`);
      filterFields.push(`  lt: ${typeStr}`);
      filterFields.push(`  lte: ${typeStr}`);
      filterFields.push(`  gt: ${typeStr}`);
      filterFields.push(`  gte: ${typeStr}`);
      filterFields.push(`  like: String`);
      filterFields.push(`  notLike: String`);
      filterFields.push(`  ilike: String`);
      filterFields.push(`  notIlike: String`);
      filterFields.push(`  inArray: [${typeStr}!]`);
      filterFields.push(`  notInArray: [${typeStr}!]`);
      filterFields.push(`  isNull: Boolean`);
      filterFields.push(`  isNotNull: Boolean`);

      // Create OR input (without OR field to avoid recursion)
      const orFilterName = `${typeName}${capitalize(columnName)}FiltersOr`;
      typeDefs.push(`input ${orFilterName} {\n${filterFields.join("\n")}\n}`);

      // Create main filter with OR support
      filterFields.push(`  OR: [${orFilterName}!]`);
      typeDefs.push(`input ${filterName} {\n${filterFields.join("\n")}\n}`);
    }

    // Generate where input type (using column filters)
    const whereFields: string[] = [];
    for (const columnName of Object.keys(tableInfo.columns)) {
      const filterName = `${typeName}${capitalize(columnName)}Filters`;
      whereFields.push(`  ${columnName}: ${filterName}`);
    }

    // Add table-level OR field
    whereFields.push(`  OR: [${typeName}FiltersOr!]`);

    // Create FiltersOr type (without OR to avoid recursion)
    const filtersOrFields: string[] = [];
    for (const columnName of Object.keys(tableInfo.columns)) {
      const filterName = `${typeName}${capitalize(columnName)}Filters`;
      filtersOrFields.push(`  ${columnName}: ${filterName}`);
    }
    typeDefs.push(
      `input ${typeName}FiltersOr {\n${filtersOrFields.join("\n")}\n}`
    );

    typeDefs.push(`input ${typeName}Filters {\n${whereFields.join("\n")}\n}`);

    // Generate order by input type (using shared InnerOrder)
    const orderByFields: string[] = [];
    for (const columnName of Object.keys(tableInfo.columns)) {
      orderByFields.push(`  ${columnName}: InnerOrder`);
    }

    typeDefs.push(`input ${typeName}OrderBy {\n${orderByFields.join("\n")}\n}`);
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

  // Add InnerOrder input (shared by all tables)
  allDefs.push(`input InnerOrder {
  direction: OrderByDirection!
  priority: Int!
}`);

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
      `  ${tableName}(where: ${typeName}Filters, orderBy: ${typeName}OrderBy, limit: Int, offset: Int): [${typeName}!]!`
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
      `  insert${typeName}(values: [${typeName}InsertInput!]!): [${typeName}!]!`
    );

    // update mutation
    mutationFields.push(
      `  update${typeName}(where: ${typeName}Filters, set: ${typeName}UpdateInput!): [${typeName}!]!`
    );

    // delete mutation
    mutationFields.push(
      `  delete${typeName}(where: ${typeName}Filters): [${typeName}!]!`
    );
  }

  return `type Mutation {\n${mutationFields.join("\n")}\n}`;
};

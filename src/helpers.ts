import { Table, getTableName, getTableColumns } from "drizzle-orm";

export interface GraphQLFieldConfig {
  type: string;
  description?: string;
}

/**
 * Helper function to customize GraphQL schema generation for specific columns.
 * Allows you to override the default type mapping and add field descriptions.
 *
 * @example
 * ```typescript
 * import { setCustomGraphQL } from 'drizzle-graphql-plus';
 *
 * export const user = sqliteTable("user", {
 *   id: text("id").primaryKey(),
 *   email: text("email").notNull(),
 *   createdAt: integer("created_at"),
 * });
 *
 * // Customize GraphQL fields - TypeScript will autocomplete column names!
 * setCustomGraphQL(user, {
 *   id: { type: "ULID", description: "Unique identifier using ULID format" },
 *   email: { type: "String", description: "User's email address" },
 *   createdAt: { type: "DateTime", description: "Account creation timestamp" },
 * });
 * ```
 *
 * You can also use shorthand for type-only config:
 * ```typescript
 * setCustomGraphQL(user, {
 *   id: "ULID",
 *   createdAt: "DateTime",
 * });
 * ```
 *
 * Then in your server, define the custom types:
 * ```typescript
 * const customTypes = `
 *   scalar ULID
 *   scalar DateTime
 * `;
 * const typeDefs = customTypes + "\n" + generatedTypeDefs;
 * ```
 */
export function setCustomGraphQL<
  T extends Table,
  TColumns = ReturnType<typeof getTableColumns<T>>
>(
  table: T,
  columnConfig: Partial<Record<keyof TColumns, string | GraphQLFieldConfig>>
): void {
  for (const [columnName, config] of Object.entries(columnConfig)) {
    const column = (table as any)[columnName];
    if (!column) {
      console.warn(
        `Warning: Column "${columnName}" not found in table "${getTableName(
          table
        )}"`
      );
      continue;
    }

    // Support both string shorthand and full config object
    if (typeof config === "string") {
      (column as any).customGraphqlType = config;
    } else if (config && typeof config === "object") {
      const fieldConfig = config as GraphQLFieldConfig;
      (column as any).customGraphqlType = fieldConfig.type;
      if (fieldConfig.description) {
        (column as any).customGraphqlDescription = fieldConfig.description;
      }
    }
  }
}

/**
 * @deprecated Use setCustomGraphQL instead
 */
export function setCustomGraphQLTypes<
  T extends Table,
  TColumns = ReturnType<typeof getTableColumns<T>>
>(table: T, columnTypes: Partial<Record<keyof TColumns, string>>): void {
  setCustomGraphQL(table, columnTypes);
}

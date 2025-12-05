import { Table, getTableName, getTableColumns } from "drizzle-orm";

/**
 * Helper function to mark columns with custom GraphQL types.
 * This allows you to use custom scalars or enums in your GraphQL schema
 * instead of the default type mappings.
 *
 * @example
 * ```typescript
 * import { setCustomGraphQLTypes } from 'drizzle-graphql-plus';
 *
 * export const user = sqliteTable("user", {
 *   id: text("id").primaryKey(),
 *   createdAt: integer("created_at"),
 * });
 *
 * // Mark columns with custom types - TypeScript will autocomplete column names!
 * setCustomGraphQLTypes(user, {
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
export function setCustomGraphQLTypes<
  T extends Table,
  TColumns = ReturnType<typeof getTableColumns<T>>
>(table: T, columnTypes: Partial<Record<keyof TColumns, string>>): void {
  for (const [columnName, graphqlType] of Object.entries(columnTypes)) {
    const column = (table as any)[columnName];
    if (!column) {
      console.warn(
        `Warning: Column "${columnName}" not found in table "${getTableName(
          table
        )}"`
      );
      continue;
    }
    (column as any).customGraphqlType = graphqlType;
  }
}

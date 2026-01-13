/**
 * Export Directive Envelop Hooks for drizzle-graphql
 *
 * Provides @export directive functionality via Envelop plugin.
 * This is a cleaner, simpler alternative to the resolver composition approach.
 * 
 * Enables cross-field dependencies in GraphQL queries by allowing
 * one field to export a value that another field can consume.
 *
 * @example
 * ```typescript
 * import { envelop, useEngine, useSchema } from '@envelop/core';
 * import { execute, subscribe, parse } from 'graphql';
 * import { useExportDirective, exportDirectiveTypeDefs } from 'drizzle-graphql-plus/export-directive-envelop-hooks';
 * 
 * // Include the directive in your schema
 * const typeDefs = `
 *   ${exportDirectiveTypeDefs}
 *   
 *   type Query {
 *     users: [User!]!
 *     posts: [Post!]!
 *   }
 * `;
 * 
 * // Add the plugin to your Envelop setup
 * const getEnveloped = envelop({
 *   plugins: [
 *     useEngine({ execute, subscribe, parse }),
 *     useSchema(schema),
 *     useExportDirective(), // Add this plugin
 *   ],
 * });
 * 
 * // Use the directive in your queries
 * const query = `
 *   query ($_userId: ID = "") {
 *     user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
 *       id @export(as: "$_userId")
 *       name
 *     }
 *     posts: postFindMany(where: { userId: { eq: $_userId } }) {
 *       title
 *     }
 *   }
 * `;
 * ```
 *
 * @see README.md for detailed usage and implementation guide
 */

export { useExportDirective } from "./plugin";
export {
    exportDirectiveTypeDefs,
    addExportDirective,
} from "./directive-definitions";
export { ExportStore } from "./ExportStore";
export {
    isExportVariable,
    getVariableName,
    resolveExportVariables,
    getExportDirective,
    hasExportVariables,
    processExports,
    logExportExecution,
    makeScalarAcceptExports,
} from "./utils";

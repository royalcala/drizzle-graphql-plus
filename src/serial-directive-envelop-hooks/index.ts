/**
 * Serial Envelop Hooks for drizzle-graphql
 *
 * Provides @serial directive functionality via Envelop plugin.
 * This is a cleaner, simpler alternative to the resolver composition approach.
 * 
 * Forces GraphQL queries to execute root-level fields sequentially instead of in parallel.
 * This is useful when you need to control the execution order of operations
 * for performance, debugging, or business logic reasons.
 *
 * @example
 * ```typescript
 * import { envelop, useEngine, useSchema } from '@envelop/core';
 * import { execute, subscribe, parse } from 'graphql';
 * import { useSerialDirective, serialDirectiveTypeDefs } from 'drizzle-graphql-plus/serial-envelop-hooks';
 * 
 * // Include the directive in your schema
 * const typeDefs = `
 *   ${serialDirectiveTypeDefs}
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
 *     useSerialDirective(), // Add this plugin
 *   ],
 * });
 * 
 * // Use the directive in your queries
 * const query = `
 *   query GetDataSequentially @serial {
 *     users { id, name }
 *     posts { id, title }
 *   }
 * `;
 * ```
 *
 * @see README.md for detailed usage and implementation guide
 */

export { useSerialDirective } from "./plugin";
export {
    serialDirectiveTypeDefs,
    addSerialDirective,
} from "./directive-definitions";
export {
    hasSerialDirective,
    createSerialExecutor,
    logSerialExecution,
    SerialExecutor,
} from "./utils";

/**
 * Serial Tool for drizzle-graphql
 *
 * Provides @serial directive functionality via resolver composition.
 * Forces GraphQL queries to execute fields sequentially instead of in parallel.
 * This is useful when you need to control the execution order of operations
 * for performance, debugging, or business logic reasons.
 *
 * @example
 * ```graphql
 * query GetDataSequentially @serial {
 *   user(id: "1") { id, name }
 *   posts(authorId: "1") { id, title }
 *   comments(postId: "1") { id, text }
 * }
 * ```
 *
 * @see README.md for detailed usage and implementation guide
 */

export { SerialExecutor } from "./SerialExecutor";
export {
  createSerialMiddleware,
  createSerialResolverMap,
  type ResolverFn,
  type ResolverMiddleware,
} from "./middleware";
export {
  serialDirectiveTypeDefs,
  addSerialDirective,
} from "./directive-definitions";
export * from "./SerialExecutor";
export * from "./middleware";
export * from "./utils";

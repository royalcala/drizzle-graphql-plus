/**
 * Export Tool for drizzle-graphql
 *
 * Provides @export directive functionality via resolver composition.
 * Enables cross-field dependencies in GraphQL queries by allowing
 * one field to export a value that another field can consume.
 *
 * @example
 * ```graphql
 * query {
 *   user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
 *     id @export(as: "userId")
 *     name
 *   }
 *   posts: postFindMany(where: { userId: { eq: $_userId } }) {
 *     title
 *   }
 * }
 * ```
 *
 * @see README.md for detailed usage and implementation guide
 */

export { ExportStore } from "./ExportStore";
export {
  createExportMiddleware,
  createExportResolverMap,
  type ResolverFn,
  type ResolverMiddleware,
} from "./middleware";
export * from "./ExportStore";
export * from "./middleware";
export * from "./utils";
export * from "./makeScalarAcceptExports";

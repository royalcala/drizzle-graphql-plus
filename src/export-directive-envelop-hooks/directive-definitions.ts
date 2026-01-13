/**
 * GraphQL directive type definitions for @export directive
 * 
 * The @export directive allows fields to export their values for use
 * by other fields in the same query. This enables cross-field dependencies.
 * 
 * @example
 * ```graphql
 * query ($_userId: ID = "") {
 *   user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
 *     id @export(as: "$_userId")
 *     name
 *   }
 *   posts: postFindMany(where: { userId: { eq: $_userId } }) {
 *     title
 *   }
 * }
 * ```
 */

/**
 * GraphQL type definition for the @export directive
 */
export const exportDirectiveTypeDefs = `
  """
  Exports a field value for use by other fields in the same query.
  The exported value can be referenced using the pattern $_variableName or EXPORT_VAR:variableName.
  Supports accumulation when used on array items.
  """
  directive @export(as: String!) on FIELD
`;

/**
 * Add export directive to existing type definitions
 * @param typeDefs - Existing GraphQL type definitions
 * @returns Type definitions with @export directive added
 */
export function addExportDirective(typeDefs: string): string {
    return `${exportDirectiveTypeDefs}\n\n${typeDefs}`;
}

/**
 * GraphQL directive type definitions for @serial directive
 * 
 * The @serial directive forces query fields to execute sequentially
 * instead of in parallel. This is useful for:
 * - Debugging and understanding execution order
 * - Performance optimization in specific scenarios
 * - Ensuring predictable execution order for business logic
 * 
 * Note: Only QUERY is supported since mutations are already
 * executed sequentially by default in GraphQL.
 */

/**
 * GraphQL type definition for the @serial directive
 */
export const serialDirectiveTypeDefs = `
  """
  Forces query fields to execute sequentially instead of in parallel.
  Root-level fields will execute one after another in the order they appear.
  Nested fields within each parent will also execute sequentially.
  """
  directive @serial on QUERY
`;

/**
 * Add serial directive to existing type definitions
 * @param typeDefs - Existing GraphQL type definitions
 * @returns Type definitions with @serial directive added
 */
export function addSerialDirective(typeDefs: string): string {
    return `${serialDirectiveTypeDefs}\n\n${typeDefs}`;
}

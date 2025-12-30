export const populateFromParentDirectiveTypeDefs = `
  """
  Populate field data from parent object instead of making new DB query.
  Only works when no complex arguments (where, orderBy, limit) are provided.
  Falls back to fresh DB query when complex filtering is needed.
  """
  directive @populateFromParent(
    """The parent field name to get data from (e.g., 'comments')"""
    source: String!
    
    """Filter to apply to parent data using simple conditions"""
    filter: JSON
    
    """Return single item instead of array"""
    single: Boolean = false
  ) on FIELD

  """JSON scalar for flexible filter conditions"""
  scalar JSON
`;

// Legacy function for backward compatibility
export const populateFromParentDirective = populateFromParentDirectiveTypeDefs;

// Usage in schema building
export function addPopulateFromParentDirective(typeDefs: string): string {
  return populateFromParentDirectiveTypeDefs + '\n' + typeDefs;
}
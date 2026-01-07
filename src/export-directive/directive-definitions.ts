/**
 * Export directive definition for GraphQL schema
 */

export const addExportDirective = (typeDefs: string): string => {
  const exportDirectiveDefinition = `directive @export(as: String!) on FIELD`;
  
  return exportDirectiveDefinition + "\n\n" + typeDefs;
};

export const exportDirectiveTypeDefs = `directive @export(as: String!) on FIELD`;
/**
 * Serial directive definition for GraphQL schema
 */

export const addSerialDirective = (typeDefs: string): string => {
  const serialDirectiveDefinition = `directive @serial on QUERY | MUTATION | SUBSCRIPTION`;

  return serialDirectiveDefinition + "\n\n" + typeDefs;
};

export const serialDirectiveTypeDefs = `directive @serial on QUERY | MUTATION | SUBSCRIPTION`;

import { GraphQLULID } from "graphql-scalars";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "../../export-directive";
import {
  buildSchemaSDL,
  makeExecutableSchema,
  exportDirectiveTypeDefs,
  commonScalars,
} from "../index";
import type { AnyDrizzleDB } from "../../types";

/**
 * Shared static configuration for creating GraphQL schemas with explicit composition
 * Used by both test files and server files - always the same setup
 */

// Setup flexible ID scalar with export support - static configuration
GraphQLULID.name = "ID";
export const FlexibleID = makeScalarAcceptExports(GraphQLULID);

/**
 * Creates our standard GraphQL schema with explicit composition
 * Always uses the same configuration - no options needed
 */
export function createStandardSchema(db: AnyDrizzleDB<any>) {
  // 1. Generate basic schema components
  const { typeDefs, resolvers } = buildSchemaSDL(db);

  // 2. Explicitly compose all directive typeDefs - always the same
  const fullTypeDefs = [
    exportDirectiveTypeDefs,
    `enum ReactionType { LIKE DISLIKE }`,
    typeDefs,
  ].join("\n\n");

  // 3. Compose all resolvers explicitly - always the same
  const composedResolvers = composeResolvers(
    {
      ...resolvers,
      ...commonScalars,
      ID: FlexibleID,
    },
    {
      "*.*": [createExportMiddleware()], // Always apply export middleware
    }
  );

  // 4. Create executable schema with makeExecutableSchema - completely explicit
  let schema = makeExecutableSchema({
    typeDefs: fullTypeDefs,
    resolvers: composedResolvers,
  });

  // 5. Apply directive transformers explicitly - always the same
  // (No directive transformers currently applied)

  return {
    schema,
    fullTypeDefs,
    composedResolvers,
  };
}

import { GraphQLULID } from "graphql-scalars";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "../../export-directive";
import { createSerialMiddleware } from "../../serial-directive";
import {
  buildSchemaSDL,
  makeExecutableSchema,
  exportDirectiveTypeDefs,
  commonScalars,
} from "../index";
import { serialDirectiveTypeDefs } from "../../serial-directive/directive-definitions";
import { envelop, useEngine, useSchema, useExtendContext } from "@envelop/core";
import { execute as graphqlExecute, subscribe, parse } from "graphql";
import { useDataLoaderCleanup } from "../generator/utils/envelop-plugin";
import type { AnyDrizzleDB } from "../../types";

/**
 * Shared configuration for creating GraphQL schemas with serial directive support
 * Used by serial directive tests
 */

// Setup flexible ID scalar with export support - static configuration
GraphQLULID.name = "ID";
export const FlexibleID = makeScalarAcceptExports(GraphQLULID);

/**
 * Creates GraphQL schema with serial directive support
 * @param db - Database instance
 * @param options - Configuration options
 */
export function createSerialSchema(
  db: AnyDrizzleDB<any>,
  options: { enableSerial?: boolean } = {}
) {
  const { enableSerial = true } = options;

  // 1. Generate basic schema components
  const { typeDefs, resolvers } = buildSchemaSDL(db);

  // 2. Compose directive typeDefs - include serial directive if enabled
  const directiveTypeDefs = [
    exportDirectiveTypeDefs,
    ...(enableSerial ? [serialDirectiveTypeDefs] : []),
    `enum ReactionType { LIKE DISLIKE }`,
  ];

  const fullTypeDefs = [...directiveTypeDefs, typeDefs].join("\n\n");

  // 3. Compose resolvers with middleware
  const middlewares = [
    createExportMiddleware(), // Always apply export middleware
    ...(enableSerial ? [createSerialMiddleware()] : []), // Apply serial middleware if enabled
  ];

  const composedResolvers = composeResolvers(
    {
      ...resolvers,
      ...commonScalars,
      ID: FlexibleID,
    },
    {
      "*.*": middlewares, // Apply all middlewares to all resolvers
    }
  );

  // 4. Create executable schema
  const schema = makeExecutableSchema({
    typeDefs: fullTypeDefs,
    resolvers: composedResolvers,
  });

  return {
    schema,
    fullTypeDefs,
    resolvers: composedResolvers,
  };
}

/**
 * Creates Envelop instance with serial directive support
 * @param db - Database instance
 * @param options - Configuration options
 */
export function createSerialEnvelop(
  db: AnyDrizzleDB<any>,
  options: { enableSerial?: boolean } = {}
) {
  const { schema } = createSerialSchema(db, options);

  return envelop({
    plugins: [
      useEngine({ execute: graphqlExecute, subscribe, parse }),
      useSchema(schema),
      // Use the same DataLoader plugin as the server
      useDataLoaderCleanup({ db }),
      useExtendContext(() => ({
        db, // Make database available in context
      })),
    ],
  });
}

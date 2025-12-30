import { createServer } from "node:http";
import { createYoga, useEnvelop } from "graphql-yoga";
import { envelop, useEngine, useSchema } from '@envelop/core';
import { GraphQLSchema, execute, subscribe } from 'graphql';
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL, useDataLoaderCleanup } from "../index";
import * as schema from "./schema";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { writeFileSync } from "node:fs";
import { GraphQLULID } from "graphql-scalars";

// Create LibSQL client
const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test.db",
});

// Create Drizzle instance
const db = drizzle(client, { schema });

import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "../../../src/export-tool";
import { composeResolvers } from "@graphql-tools/resolvers-composition";

// Build GraphQL schema with DataLoader always enabled
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add custom scalar/enum definitions for types marked with customGraphqlType
const customTypeDefinitions = `
directive @export(as: String!) on FIELD
 enum ReactionType {
    LIKE
    DISLIKE
  }
`;

const extendedTypeDefs = customTypeDefinitions + "\n" + typeDefs;

GraphQLULID.name = "ID";
// Add scalar resolvers for custom types
// Use makeScalarAcceptExports to allow export patterns
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);
const customScalarResolvers = {
  ID: FlexibleULID,
};

const resolversWithScalars = {
  ...resolvers,
  ...customScalarResolvers,
};

// Compose resolvers with export middleware
const composedResolvers = composeResolvers(resolversWithScalars, {
  "*.*": [createExportMiddleware()],
});

export const graphqlSchema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: composedResolvers,
});

writeFileSync("src/build-schema-sdl-with-dl/tests/auto-generated-schema.graphql", extendedTypeDefs);

// Create Envelop instance with comprehensive DataLoader plugin
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe }),
    useSchema(graphqlSchema),
    useDataLoaderCleanup({ db }), // Handles context creation, db injection, AND cleanup automatically
  ],
});

// Create Yoga server with Envelop
const yoga = createYoga({
  plugins: [useEnvelop(getEnveloped)],
  graphiql: {
    title: "Drizzle-GraphQL DataLoader Test Server",
  },
  context: async ({ request }) => {
    // DataLoader context AND database are automatically injected by the plugin!
    // Just add your other context properties
    return {
      request,
      // db and relationLoaders are added automatically by the plugin
    };
  },
});

// Create HTTP server
const server = createServer(yoga);

const PORT = 4001; // Different port to avoid conflicts

server.listen(PORT, async () => {
  console.log(`🚀 DataLoader Test Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing DataLoader performance`);
  console.log(`🔄 DataLoader is enabled for optimized relational queries`);
});
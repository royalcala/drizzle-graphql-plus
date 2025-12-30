import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL } from "../index";
import * as schema from "./schema";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { writeFileSync } from "node:fs";
import { GraphQLULID } from "graphql-scalars";
import { createDataLoaderContext, cleanupDataLoaderContext } from "../generator/utils/context";

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

// Create Yoga server with DataLoader context
const yoga = createYoga({
  schema: graphqlSchema,
  graphiql: {
    title: "Drizzle-GraphQL DataLoader Test Server",
  },
  context: async ({ request }) => {
    // Create DataLoader context for each request
    const dataLoaderContext = createDataLoaderContext();
    
    return {
      // Your existing context
      request,
      // Add database instance for DataLoader resolvers
      db,
      // Add DataLoader context
      ...dataLoaderContext,
    };
  },
  plugins: [
    // Plugin to automatically cleanup DataLoaders after each request
    {
      onRequestResult: ({ result }) => {
        // Cleanup DataLoaders after request completion
        if (result.context?.relationLoaders) {
          cleanupDataLoaderContext(result.context);
        }
      }
    }
  ]
});

// Create HTTP server
const server = createServer(yoga);

const PORT = 4001; // Different port to avoid conflicts

server.listen(PORT, async () => {
  console.log(`🚀 DataLoader Test Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing DataLoader performance`);
  console.log(`🔄 DataLoader is enabled for optimized relational queries`);
});
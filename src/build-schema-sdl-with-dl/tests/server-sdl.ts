import { createServer } from "node:http";
import { createYoga, useEnvelop } from "graphql-yoga";
import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute, subscribe } from 'graphql';
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { writeFileSync } from "node:fs";
import { createDataLoaderContext, cleanupDataLoaderContext } from "../generator/utils/context";
import { createStandardSchema } from "./shared-config";

// Create LibSQL client
const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test.db",
});

// Create Drizzle instance
const db = drizzle(client, { schema });

// ===== USE SHARED STANDARD SCHEMA CONFIGURATION =====
const { schema: graphqlSchema, fullTypeDefs } = createStandardSchema(db);

// Export the schema for external use
export { graphqlSchema };

// Write the schema to file for inspection
writeFileSync("src/build-schema-sdl-with-dl/tests/auto-generated-schema.graphql", fullTypeDefs);

// Create Envelop instance with explicit DataLoader context management
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe }),
    useSchema(graphqlSchema),
    // Custom plugin for DataLoader context management
    {
      onContextBuilding: ({ extendContext }) => {
        // Create DataLoader context for this request
        const dataLoaderContext = createDataLoaderContext();
        extendContext({
          db, // Inject database instance
          ...dataLoaderContext, // Inject DataLoader context
        });
      },
    },
  ],
});

// Create Yoga server with Envelop
const yoga = createYoga({
  plugins: [useEnvelop(getEnveloped)],
  graphiql: {
    title: "Drizzle-GraphQL DataLoader Test Server - Explicit Composition",
  },
  context: async ({ request }) => {
    // DataLoader context and database are injected by the Envelop plugin
    // Just add your other context properties here
    return {
      request,
      // db and DataLoader context are added automatically by the plugin
    };
  },
});

// Create HTTP server
const server = createServer(yoga);

const PORT = 4001; // Different port to avoid conflicts

server.listen(PORT, async () => {
  console.log(`🚀 DataLoader Test Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing DataLoader performance`);
  console.log(`🔄 DataLoader is enabled with SHARED STANDARD composition - simple and consistent!`);
  console.log(`✨ Schema built using standard shared configuration`);
});
import { createServer } from "node:http";
import { createYoga, useEnvelop } from "graphql-yoga";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { writeFileSync } from "node:fs";
import { createSharedEnvelop } from "./shared-envelop";
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

// Create shared envelop configuration
const getEnveloped = createSharedEnvelop(db);

// Create Yoga server with Envelop
const yoga = createYoga({
  plugins: [useEnvelop(getEnveloped)],
  graphiql: {
    title: "Drizzle-GraphQL DataLoader Test Server - Explicit Composition",
  },
  context: async ({ request }) => {
    // DataLoader context and database are automatically injected by useDataLoaderCleanup plugin
    // Just add your other context properties here
    return {
      request,
      // db and DataLoader context (relationLoaders) are added automatically by the plugin
    };
  },
});

// Create HTTP server
const server = createServer(yoga);

const PORT = 4001; // Different port to avoid conflicts

server.listen(PORT, async () => {
  console.log(`🚀 DataLoader Test Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing DataLoader performance`);
  console.log(`🔄 DataLoader is enabled with shared envelop configuration`);
  console.log(`✨ Schema built using standard shared configuration with useDataLoaderCleanup plugin`);
});
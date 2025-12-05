import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchema } from "../src/index";
import * as schema from "./schema";

// Create LibSQL client
const client = createClient({
  url: "file:test-server/test.db",
});

// Create Drizzle instance
const db = drizzle(client, { schema });

// Build GraphQL schema
const { schema: graphqlSchema } = buildSchema(db);

// Create Yoga server
const yoga = createYoga({
  schema: graphqlSchema,
  graphiql: {
    title: "Drizzle-GraphQL Test Server",
  },
});

// Create HTTP server
const server = createServer(yoga);

const PORT = 4000;

server.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing`);
  console.log(`\nTest the interface fragments with queries like:`);
});

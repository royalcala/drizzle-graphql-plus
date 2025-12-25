import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL } from "../src/index";
import * as schema from "./schema";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { writeFileSync } from "node:fs";
import { GraphQLULID } from "graphql-scalars";

// Create LibSQL client
const client = createClient({
  url: "file:test-server/test.db",
});

// Create Drizzle instance
const db = drizzle(client, { schema });

import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "../src/export-tool";
import { composeResolvers } from "@graphql-tools/resolvers-composition";

// Build GraphQL schema
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add custom scalar/enum definitions for types marked with customGraphqlType
const customTypeDefinitions = `
directive @export(as: String!) on FIELD
scalar ULID
 enum ReactionType {
    LIKE
    DISLIKE
  }
`;

const extendedTypeDefs = customTypeDefinitions + "\n" + typeDefs;

// Add scalar resolvers for custom types
// Use makeScalarAcceptExports to allow export patterns
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);
const customScalarResolvers = {
  ULID: FlexibleULID,
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

writeFileSync("test-server/auto-generated-schema.graphql", extendedTypeDefs);
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

server.listen(PORT, async () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
  console.log(`📊 GraphiQL interface available for testing`);
});

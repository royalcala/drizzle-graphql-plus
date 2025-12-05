import { is } from "drizzle-orm";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { AnyDrizzleDB, BuildSchemaConfig } from "../types";
import {
  generateTypes,
  generateTypeDefs,
  generateQueryTypeDefs,
  generateMutationTypeDefs,
} from "./generator/schema";
import { generateQueries } from "./generator/queries";
import { generateMutations } from "./generator/mutations";

export type BuildSchemaSDLResult = {
  typeDefs: string;
  resolvers: Record<string, any>;
};

export const buildSchemaSDL = <TDbClient extends AnyDrizzleDB<any>>(
  db: TDbClient,
  config?: BuildSchemaConfig
): BuildSchemaSDLResult => {
  const schema = db._.fullSchema;
  if (!schema) {
    throw new Error(
      "Drizzle-GraphQL Error: Schema not found in drizzle instance. Make sure you're using drizzle-orm v0.30.9 or above and schema is passed to drizzle constructor!"
    );
  }

  // Only support SQLite for now
  if (!is(db, BaseSQLiteDatabase)) {
    throw new Error(
      "Drizzle-GraphQL Error: buildSchemaSDL currently only supports SQLite databases"
    );
  }

  // Generate table information and relations
  const { tables, relations } = generateTypes(db, schema);

  // Generate type definitions
  const typeDefsArray: string[] = [];

  // Add table types and input types
  typeDefsArray.push(generateTypeDefs(tables, relations));

  // Add Query type
  typeDefsArray.push(generateQueryTypeDefs(tables));

  // Add Mutation type if enabled
  if (config?.mutations !== false) {
    typeDefsArray.push(generateMutationTypeDefs(tables));
  }

  const typeDefs = typeDefsArray.join("\n\n");

  // Generate resolvers
  const queries = generateQueries(db, tables, relations);
  const resolvers: Record<string, any> = {
    Query: queries,
  };

  // Add mutation resolvers if enabled
  if (config?.mutations !== false) {
    const mutations = generateMutations(db, tables);
    resolvers["Mutation"] = mutations;
  }

  return {
    typeDefs,
    resolvers,
  };
};

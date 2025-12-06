import { is, type InferSelectModel } from "drizzle-orm";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { AnyDrizzleDB, BuildSchemaConfig } from "../types";
import {
  generateTypes,
  generateTypeDefs,
  generateQueryTypeDefs,
  generateMutationTypeDefs,
} from "./generator/schema";
import { generateQueries, type QueryResolvers } from "./generator/queries";
import {
  generateMutations,
  type MutationResolvers,
} from "./generator/mutations";

type Capitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

// Type for column filters
type ColumnFilter<T = any> = {
  eq?: T;
  ne?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  like?: string;
  notLike?: string;
  ilike?: string;
  notIlike?: string;
  inArray?: T[];
  notInArray?: T[];
  isNull?: boolean;
  isNotNull?: boolean;
  OR?: ColumnFilter<T>[];
};

// Type for where input based on table columns
type WhereInput<TTable> = TTable extends { $inferSelect: infer S }
  ? {
      [K in keyof S]?: ColumnFilter<S[K]>;
    } & {
      OR?: WhereInput<TTable>[];
    }
  : never;

// Type for orderBy input
type OrderByInput<TTable> = TTable extends { $inferSelect: infer S }
  ? {
      [K in keyof S]?: {
        direction: "asc" | "desc";
        priority: number;
      };
    }
  : never;

// Type for query arguments
type QueryArgs<TTable> = {
  where?: WhereInput<TTable>;
  orderBy?: OrderByInput<TTable>;
  limit?: number;
  offset?: number;
};

// Type for insert input
type InsertInput<TTable> = TTable extends { $inferInsert: infer I } ? I : never;

// Type for update input
type UpdateInput<TTable> = TTable extends { $inferInsert: infer I }
  ? Partial<I>
  : never;

export type BuildSchemaSDLResult<
  TSchema extends Record<string, any> = Record<string, any>
> = {
  typeDefs: string;
  resolvers: {
    Query: {
      [K in keyof TSchema as TSchema[K] extends { $inferSelect: any }
        ? K
        : never]: (
        parent: any,
        args: QueryArgs<TSchema[K]>,
        context: any,
        info: any
      ) => Promise<InferSelectModel<TSchema[K]>[]>;
    };
    Mutation: {
      [K in keyof TSchema as TSchema[K] extends { $inferSelect: any }
        ? `insert${Capitalize<K & string>}`
        : never]: (
        parent: any,
        args: { data: InsertInput<TSchema[K]> | InsertInput<TSchema[K]>[] },
        context: any,
        info: any
      ) => Promise<InferSelectModel<TSchema[K]>[]>;
    } & {
      [K in keyof TSchema as TSchema[K] extends { $inferSelect: any }
        ? `update${Capitalize<K & string>}`
        : never]: (
        parent: any,
        args: { data: UpdateInput<TSchema[K]>; where: WhereInput<TSchema[K]> },
        context: any,
        info: any
      ) => Promise<InferSelectModel<TSchema[K]>[]>;
    } & {
      [K in keyof TSchema as TSchema[K] extends { $inferSelect: any }
        ? `delete${Capitalize<K & string>}`
        : never]: (
        parent: any,
        args: { where: WhereInput<TSchema[K]> },
        context: any,
        info: any
      ) => Promise<InferSelectModel<TSchema[K]>[]>;
    };
    [key: string]: any;
  };
};

export const buildSchemaSDL = <
  TDbClient extends AnyDrizzleDB<any>,
  TSchema extends Record<string, any> = TDbClient extends {
    _: { fullSchema: infer S };
  }
    ? S
    : Record<string, any>
>(
  db: TDbClient,
  config?: BuildSchemaConfig
): BuildSchemaSDLResult<TSchema> => {
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

  // Add Mutation type
  typeDefsArray.push(generateMutationTypeDefs(tables));

  const typeDefs = typeDefsArray.join("\n\n");

  // Generate resolvers
  const queries = generateQueries(db, tables, relations);
  const mutations = generateMutations(db, tables);

  return {
    typeDefs,
    resolvers: {
      Query: queries,
      Mutation: mutations,
    } as BuildSchemaSDLResult<TSchema>["resolvers"],
  };
};

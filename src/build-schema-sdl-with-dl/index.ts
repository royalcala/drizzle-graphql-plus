import { is, type InferSelectModel } from "drizzle-orm";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { AnyDrizzleDB } from "../types";
import {
    generateTypes,
    generateTypeDefs,
    generateQueryTypeDefs,
    generateMutationTypeDefs,
} from "./generator/schema";
import { generateQueries } from "./generator/queries";
import { generateMutations } from "./generator/mutations";
import { GraphQLJSON } from "./scalars/json";
import type { GraphQLSchema } from "graphql";
import { exportDirectiveTypeDefs } from "../export-tool/directive-definitions";

export type Capitalize<S extends string> = S extends `${infer F}${infer R}`
    ? `${Uppercase<F>}${R}`
    : S;

// Type for column filters
export type ColumnFilter<T = any> = {
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
export type WhereInput<TTable> = TTable extends { $inferSelect: infer S }
    ? {
        [K in keyof S]?: ColumnFilter<S[K]>;
    } & {
        OR?: WhereInput<TTable>[];
    }
    : never;

// Type for orderBy input
export type OrderByInput<TTable> = TTable extends { $inferSelect: infer S }
    ? {
        [K in keyof S]?: {
            direction: "asc" | "desc";
            priority: number;
        };
    }
    : never;

// Type for query arguments
export type QueryArgs<TTable> = {
    where?: WhereInput<TTable>;
    orderBy?: OrderByInput<TTable>;
    limit?: number;
    offset?: number;
};

// Type for insert input
export type InsertInput<TTable> = TTable extends { $inferInsert: infer I }
    ? I
    : never;

// Type for update input
export type UpdateInput<TTable> = TTable extends { $inferInsert: infer I }
    ? Partial<I>
    : never;

// Enhanced config with DataLoader options
export interface BuildSchemaSDLConfig {
    debug?: {
        dataLoader?: boolean;  // Enable DataLoader debug logs
        exportVariables?: boolean;  // Enable export variable resolution logs
    };
}

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
    config?: BuildSchemaSDLConfig
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

    // Generate resolvers with DataLoader support (always enabled)
    const queries = generateQueries(db, tables, relations, config?.debug);
    const { mutations, deleteResultResolvers } = generateMutations(
        db,
        tables,
        relations,
        config?.debug
    );

    const resolvers = {
        Query: queries,
        Mutation: mutations,
        ...deleteResultResolvers,
    } as BuildSchemaSDLResult<TSchema>["resolvers"];

    return {
        typeDefs,
        resolvers,
    };
};



// Export commonly used scalars
export const commonScalars = {
    JSON: GraphQLJSON,
};

// Export individual directive typeDefs
export { exportDirectiveTypeDefs } from '../export-tool/directive-definitions';

// Re-export makeExecutableSchema for user convenience
export { makeExecutableSchema } from "@graphql-tools/schema";

// Re-export directive transformers for explicit composition
export { GraphQLJSON } from './scalars/json';
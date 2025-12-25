
import { GraphQLScalarType, Kind, ValueNode } from "graphql";

/**
 * Creates a version of a Scalar that accepts export variable patterns.
 * 
 * This allows a scalar (like Int, ULID, Date) to pass validation when the value
 * is a string starting with "$_" (indicating an export variable reference), 
 * while maintaining strict validation for all other values.
 * 
 * @param originalScalar The original GraphQLScalarType (e.g. GraphQLInt, GraphQLULID)
 * @returns A new GraphQLScalarType that wraps the original with flexible validation
 * 
 * @example
 * ```typescript
 * import { GraphQLInt } from "graphql";
 * import { makeScalarAcceptExports } from "drizzle-graphql/export-tool";
 * 
 * const FlexibleInt = makeScalarAcceptExports(GraphQLInt);
 * 
 * const resolvers = {
    ...
 *   Int: FlexibleInt, // Override standard Int
 * };
 * ```
 */
export function makeScalarAcceptExports(originalScalar: GraphQLScalarType): GraphQLScalarType {
    const config = originalScalar.toConfig();

    return new GraphQLScalarType({
        ...config,
        name: config.name, // Keep original name to override it in schema
        description: `${config.description} (Wrapped with makeScalarAcceptExports to accept $_ export variables)`,

        serialize: config.serialize,

        parseValue(value: unknown) {
            // 1. Allow export variable patterns
            if (typeof value === "string" && (value.startsWith("$_") || value === "")) {
                return value;
            }

            // 2. Delegate to original parser
            if (config.parseValue) {
                return config.parseValue(value);
            }
            return value;
        },

        parseLiteral(ast: ValueNode, variables?: any) {
            // 1. Allow export variable patterns in String literals
            if (ast.kind === Kind.STRING) {
                if (ast.value.startsWith("$_") || ast.value === "") {
                    return ast.value;
                }
            }

            // 2. Delegate to original parser
            if (config.parseLiteral) {
                return config.parseLiteral(ast, variables);
            }
            return undefined; // Should ideally throw or return default behavior if no parseLiteral
        },
    });
}


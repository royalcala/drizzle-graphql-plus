import {
  FieldNode,
  DirectiveNode,
  Kind,
  ValueNode,
  ObjectValueNode,
  ListValueNode,
  GraphQLScalarType,
} from "graphql";
import { ExportStore } from "./ExportStore";

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
 *    ...
 *   Int: FlexibleInt, // Override standard Int
 * };
 * ```
 */
export function makeScalarAcceptExports(
  originalScalar: GraphQLScalarType
): GraphQLScalarType {
  const config = originalScalar.toConfig();

  return new GraphQLScalarType({
    ...config,
    name: config.name, // Keep original name to override it in schema
    description:
      config.description +
      " (Wrapped with makeScalarAcceptExports to accept $_ export variables)",

    serialize: config.serialize,

    parseValue(value: unknown) {
      // 1. Allow export variable patterns
      if (
        typeof value === "string" &&
        (value.startsWith("$_") || value === "")
      ) {
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

      if (config.parseLiteral && ast) {
        return config.parseLiteral(ast, variables);
      }
      return undefined; // Should ideally throw or return default behavior if no parseLiteral
    },
  });
}

/**
 * Check if a value is a string that represents an export variable
 * Supports both "$_variableName" and "EXPORT_VAR:variableName" syntax
 */
export function isExportVariable(value: any): value is string {
  if (typeof value !== "string") {
    return false;
  }

  // Support both syntaxes:
  // 1. "$_variableName" (original, but conflicts with GraphQL variables)
  // 2. "EXPORT_VAR:variableName" (new, GraphQL-safe)
  return (
    (value.startsWith("$_") && value.length > 2) ||
    (value.startsWith("EXPORT_VAR:") && value.length > 11)
  );
}

/**
 * Extract variable name from export pattern
 * Supports: "$_userId" -> "userId" and "EXPORT_VAR:userId" -> "userId"
 */
export function getVariableName(value: string): string | null {
  if (!isExportVariable(value)) {
    return null;
  }

  if (value.startsWith("$_")) {
    return value.slice(2); // Remove $_
  } else if (value.startsWith("EXPORT_VAR:")) {
    return value.slice(11); // Remove EXPORT_VAR:
  }

  return null;
}

/**
 * Recursively resolve export variables in arguments
 */
export async function resolveExportVariables(
  args: any,
  exportStore: ExportStore,
  timeout = 5000
): Promise<any> {
  // Handle primitive export variables (e.g., "$_userId")
  if (isExportVariable(args)) {
    const varName = getVariableName(args)!;
    const resolvedValue = await exportStore.waitFor(varName, timeout, false);
    return resolvedValue;
  }

  // Handle arrays
  if (Array.isArray(args)) {
    const resolved = await Promise.all(
      args.map(async (item) => {
        if (isExportVariable(item)) {
          const varName = getVariableName(item)!;
          const resolvedValue = await exportStore.waitFor(
            varName,
            timeout,
            false
          );
          // If resolved value is an array, spread it into the parent array
          return Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];
        } else if (typeof item === "object" && item !== null) {
          return await resolveExportVariables(item, exportStore, timeout);
        }
        return item;
      })
    );
    // Flatten the resolved array to handle spread values from export variables
    return resolved.flat();
  }

  // Handle objects recursively
  if (typeof args === "object" && args !== null) {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      if (isExportVariable(value)) {
        const varName = getVariableName(value)!;
        const resolvedValue = await exportStore.waitFor(
          varName,
          timeout,
          false
        );
        resolved[key] = resolvedValue;
      } else if (typeof value === "object" && value !== null) {
        resolved[key] = await resolveExportVariables(
          value,
          exportStore,
          timeout
        );
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  // Return primitive values unchanged
  return args;
}

/**
 * Extract @export directive from a field selection
 * Returns the export name if directive exists, otherwise null
 */
export function getExportDirective(fieldNode: FieldNode): string | null {
  if (!fieldNode || !fieldNode.directives) {
    return null;
  }

  // Find @export directive
  const exportDirective = fieldNode.directives.find(
    (directive: DirectiveNode) => directive.name.value === "export"
  );

  if (!exportDirective) {
    return null;
  }

  // Extract 'as' argument
  const asArg = exportDirective.arguments?.find(
    (arg) => arg.name.value === "as"
  );

  if (!asArg || asArg.value.kind !== "StringValue") {
    return null;
  }

  return asArg.value.value;
}

/**
 * Check if arguments contain any export variables
 */
export function hasExportVariables(args: any): boolean {
  // Handle primitive export variables
  if (isExportVariable(args)) {
    return true;
  }

  // Handle arrays
  if (Array.isArray(args)) {
    return args.some((item) => hasExportVariables(item));
  }

  // Handle objects
  if (typeof args === "object" && args !== null) {
    for (const value of Object.values(args)) {
      if (hasExportVariables(value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Process result object against selection set to find and store exports
 * @param result The result object from the resolver
 * @param selectionSet The GraphQL selection set
 * @param exportStore The export store to store values
 * @param isArrayItem True if this result is an item from an array (enables accumulation)
 */
export function processExports(
  result: any,
  selectionSet: import("graphql").SelectionSetNode,
  exportStore: ExportStore,
  variables?: Record<string, any>,
  isArrayItem = false
): void {
  if (!result || !selectionSet) return;

  for (const selection of selectionSet.selections) {
    if (selection.kind !== "Field") continue;

    // Handle aliases: result key is alias if present, otherwise field name
    const resultKey = selection.alias?.value ?? selection.name.value;

    // Skip if field is not in result (e.g. was not fetched or skipped)
    if (!(resultKey in result)) {
      continue;
    }

    const value = result[resultKey];

    // 1. Check for @export on this field
    const exportName = getExportDirective(selection);
    if (exportName) {
      logExportExecution("Found @export directive: " + exportName, {
        isArrayItem,
        value: typeof value,
      });

      // Store the value
      if (isArrayItem) {
        exportStore.accumulate(exportName, value);
      } else {
        exportStore.set(exportName, value);
      }

      // Update variables if provided
      if (variables && exportName.startsWith("$_")) {
        const varName = "_" + exportName.slice(2);
        if (isArrayItem) {
          // Accumulate in variables (with basic deduplication like ExportStore, or just push)
          if (!variables[varName]) {
            variables[varName] = [];
          }
          if (Array.isArray(variables[varName])) {
            // Avoid duplicates if possible, or just push.
            // Drizzle-graphql might rely on exact array matches?
            // ExportStore uses Set for deduplication.
            if (!variables[varName].includes(value)) {
              variables[varName].push(value);
            }
          }
        } else {
          variables[varName] = value;
        }
        logExportExecution(
          "Updated GraphQL variable: " + varName,
          variables[varName]
        );
      }
    }

    // 2. Recurse if nested selection exists and value is traversable
    if (selection.selectionSet && value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === "object") {
            // Mark that we're processing array items
            processExports(
              item,
              selection.selectionSet!,
              exportStore,
              variables,
              true
            );
          }
        });
      } else if (typeof value === "object") {
        // Keep isArrayItem flag for nested objects within array items
        processExports(
          value,
          selection.selectionSet!,
          exportStore,
          variables,
          isArrayItem
        );
      }
    }
  }
}

/**
 * Recursively inspects arguments AST to find GraphQL Variables and waits for their exports.
 * This handles the race condition where a field starts executing before its dependency export (from a sibling) has finished.
 */
export async function resolveGraphQLVariables(
  args: any,
  fieldNode: FieldNode,
  exportStore: ExportStore,
  timeout = 5000
): Promise<void> {
  if (!fieldNode.arguments || !args) return;

  logExportExecution("resolveGraphQLVariables starting", {
    argsKeys: Object.keys(args),
  });

  for (const arg of fieldNode.arguments) {
    const argName = arg.name.value;
    if (argName in args) {
      await traverseASTAndResolve(
        arg.value,
        args,
        argName,
        exportStore,
        timeout
      );
    } else {
      logExportExecution("argName not in args", argName);
    }
  }
}

/**
 * Normalize GraphQL filter operators so they align with Drizzle's
 * expected operator names. For example, map `in` -> `inArray` so
 * IDFieldFilter and similar inputs work with the underlying query
 * builder.
 */
export function normalizeFilterOperators(obj: any): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => normalizeFilterOperators(item));
    return;
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // Map common GraphQL-style `in` operator to Drizzle's
    // expected `inArray` operator when appropriate.
    if (key === "in" && value !== undefined && !("inArray" in obj)) {
      obj.inArray = value;
      delete obj.in;
    } else if (value && typeof value === "object") {
      normalizeFilterOperators(value);
    }
  }
}

async function traverseASTAndResolve(
  node: ValueNode,
  parentObj: any,
  key: string | number,
  exportStore: ExportStore,
  timeout: number
): Promise<void> {
  logExportExecution("traverseASTAndResolve", { kind: node.kind, key });

  if (node.kind === Kind.VARIABLE) {
    const varName = node.name.value;

    const candidateNames = ["$" + varName, varName];
    if (varName.startsWith("_")) {
      candidateNames.push("$" + varName); // $_userId
    } else {
      candidateNames.push("$_" + varName);
    }

    const currentValue = parentObj[key];
    const isDefault =
      currentValue === undefined ||
      currentValue === "" ||
      (Array.isArray(currentValue) &&
        (currentValue.length === 0 ||
          (currentValue.length === 1 && currentValue[0] === "")));

    logExportExecution("Checking variable", {
      varName,
      currentValue,
      isDefault,
    });

    if (isDefault) {
      const exportName = "$" + varName;
      logExportExecution("Waiting for export variable mapping", {
        varName,
        exportName,
      });
      try {
        const val = await exportStore.waitFor(exportName, timeout, true);
        if (val !== undefined) {
          parentObj[key] = val;
          logExportExecution(
            "Resolved variable " + varName + " to export " + exportName,
            val
          );
        } else {
          logExportExecution(
            "Export variable resolved to undefined (allowed)",
            exportName
          );
        }
      } catch (e) {
        logExportExecution(
          "Timeout waiting for variable " + varName + " as export " + exportName
        );
      }
    }
  } else if (node.kind === Kind.OBJECT) {
    // Ensure we have an object to work with even if the
    // original argument value was missing or undefined.
    let obj = parentObj[key];
    if (!obj || typeof obj !== "object") {
      obj = {};
      parentObj[key] = obj;
    }

    for (const field of node.fields) {
      const fieldName = field.name.value;
      await traverseASTAndResolve(
        field.value,
        obj,
        fieldName,
        exportStore,
        timeout
      );
    }
  } else if (node.kind === Kind.LIST) {
    // Ensure we have a list value to mirror the AST list
    let list = parentObj[key];
    if (!Array.isArray(list)) {
      list = new Array(node.values.length).fill(undefined);
      parentObj[key] = list;
    }

    // Assuming AST list matches value list by index.
    const len = Math.min(list.length, node.values.length);
    for (let i = 0; i < len; i++) {
      await traverseASTAndResolve(
        node.values[i],
        list,
        i,
        exportStore,
        timeout
      );
    }
  }
}

/**
 * Log export execution information for debugging
 * @param message - The message to log
 * @param data - Additional data to log
 */
export function logExportExecution(message: string, data?: any): void {
  if (process.env.DEBUG_EXPORT) {
    console.log("[EXPORT-HOOK] " + message, data || "");
  }
}

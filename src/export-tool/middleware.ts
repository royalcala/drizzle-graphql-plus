import { GraphQLResolveInfo } from "graphql";
import { ExportStore } from "./ExportStore";

import {
  resolveExportVariables,
  getExportDirective,
  processExports,
  hasExportVariables,
} from "./utils";

/**
 * Resolver function signature from @graphql-tools/resolvers-composition
 */
export type ResolverFn<
  TSource = any,
  TContext = any,
  TArgs = any,
  TResult = any
> = (
  source: TSource,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

/**
 * Middleware function that wraps a resolver
 */
export type ResolverMiddleware = (next: ResolverFn) => ResolverFn;

/**
 * Create export middleware that wraps resolvers to handle @export directive
 *
 * This middleware:
 * 1. Before resolver execution: Checks if arguments contain $_varName patterns
 *    and waits for/replaces them with actual exported values
 * 2. After resolver execution: Checks if any fields have @export directive
 *    and stores those values in the ExportStore
 *
 * @returns Middleware function for resolver composition
 */
export function createExportMiddleware(): ResolverMiddleware {
  return (next: ResolverFn) => {
    return async (
      source: any,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      // Initialize ExportStore in context if not already present
      if (!context.exportStore) {
        context.exportStore = new ExportStore();
      }

      const exportStore = context.exportStore as ExportStore;

      // STEP 1: Resolve any export variables in arguments (before execution)
      let resolvedArgs = args;
      if (args && typeof args === "object" && hasExportVariables(args)) {
        try {
          resolvedArgs = await resolveExportVariables(args, exportStore);
        } catch (error) {
          // If timeout or error waiting for export, throw meaningful error
          throw new Error(
            `Failed to resolve export variables in ${info.parentType.name}.${info.fieldName
            }: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // STEP 2: Execute the actual resolver with resolved arguments
      const result = await next(source, resolvedArgs, context, info);

      // STEP 3: Check if any fields in the result have @export directive (after execution)
      const fieldNode = info.fieldNodes[0];
      if (!fieldNode) return result;

      // 3.1 Check export on the field itself (scalar or object)
      const selfExportName = getExportDirective(fieldNode);
      if (selfExportName && result !== undefined && result !== null) {
        exportStore.set(selfExportName, result);
      }

      // 3.2 Check nested exports (recursively) via selection set
      if (fieldNode.selectionSet && result !== undefined && result !== null) {
        if (Array.isArray(result)) {
          result.forEach((item) => {
            if (item && typeof item === "object") {
              processExports(item, fieldNode.selectionSet!, exportStore);
            }
          });
        } else if (typeof result === "object") {
          processExports(result, fieldNode.selectionSet, exportStore);
        }
      }

      return result;
    };
  };
}

/**
 * Create a resolver map pattern for composeResolvers
 * This applies the export middleware to all resolvers
 *
 * @returns Object with pattern matching all resolvers
 *
 * @example
 * ```typescript
 * import { composeResolvers } from '@graphql-tools/resolvers-composition';
 * import { createExportResolverMap } from 'drizzle-graphql/export-tool';
 *
 * const composedResolvers = composeResolvers(resolvers, createExportResolverMap());
 * ```
 */
export function createExportResolverMap() {
  return {
    // Apply to all resolvers (Query.*, Mutation.*, etc.)
    "*.*": [createExportMiddleware()],
  };
}

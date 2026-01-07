import { GraphQLResolveInfo } from "graphql";
import { ExportStore } from "./ExportStore";
import {
  resolveExportVariables,
  hasExportVariables,
  getExportDirective,
  processExports,
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
 * Create export middleware that handles @export directive
 *
 * This middleware works with @serial directive to ensure proper execution order:
 * 1. Resolves export variables in arguments before executing resolver
 * 2. Stores exported values after resolver execution
 * 3. Processes nested exports in selection sets
 *
 * IMPORTANT: Use @serial directive on queries that use export/import to ensure sequential execution!
 *
 * @returns Resolver middleware function
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

      // STEP 1: Resolve export variables in arguments (with serial directive, this works reliably)
      let resolvedArgs = args;
      if (args && typeof args === "object" && hasExportVariables(args)) {
        try {
          resolvedArgs = await resolveExportVariables(args, exportStore, 10000); // 10s timeout
        } catch (error) {
          throw new Error(
            `Export variable resolution failed in ${info.parentType.name}.${
              info.fieldName
            }: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // STEP 2: Execute the resolver with resolved arguments
      const result = await next(source, resolvedArgs, context, info);

      // STEP 3: Store exported values from the result
      const fieldNode = info.fieldNodes[0];
      if (!fieldNode) return result;

      // Check if the field itself has @export directive
      const selfExportName = getExportDirective(fieldNode);
      if (selfExportName && result !== undefined && result !== null) {
        if (Array.isArray(result)) {
          // For arrays, accumulate each item
          result.forEach((value) => {
            if (value !== undefined && value !== null) {
              exportStore.accumulate(selfExportName, value);
            }
          });
        } else {
          // For single values, just set
          exportStore.set(selfExportName, result);
        }
      }

      // 3.2 Check nested exports (recursively) via selection set
      if (fieldNode.selectionSet && result !== undefined && result !== null) {
        if (Array.isArray(result)) {
          result.forEach((item) => {
            if (item && typeof item === "object") {
              // Mark that we're processing array items
              processExports(item, fieldNode.selectionSet!, exportStore, true);
            }
          });
        } else if (typeof result === "object") {
          // Single object, not an array item
          processExports(result, fieldNode.selectionSet, exportStore, false);
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

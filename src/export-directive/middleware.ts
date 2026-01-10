import { GraphQLResolveInfo } from "graphql";
import { ExportStore } from "./ExportStore";
import {
  resolveExportVariables,
  hasExportVariables,
  getExportDirective,
  processExports,
  processExportsSync,
  resolveGraphQLVariables,
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
      // console.log("🔧 Export middleware called for field:", info.fieldName);

      // Initialize ExportStore in context if not already present
      if (!context.exportStore) {
        context.exportStore = new ExportStore();
        // console.log("🔧 Created new ExportStore in context");
      } else {
        // console.log("🔧 Using existing ExportStore from context");
      }

      const exportStore = context.exportStore as ExportStore;

      // Store reference to execution context for variable updates
      // Try to access the actual GraphQL variables being used from multiple possible locations
      if (!context._graphqlVariables) {
        // Check various locations where variables might be stored in the execution context
        const variableValues =
          (info as any).variableValues ||
          (context as any).variableValues ||
          (info.operation as any).variableValues ||
          ((info as any).executionContext &&
            (info as any).executionContext.variableValues) ||
          ((info as any).rootValue && (info as any).rootValue.variableValues);

        if (variableValues) {
          context._graphqlVariables = variableValues;
          console.log(
            "🔍 Found GraphQL variables at execution time:",
            Object.keys(variableValues)
          );
        } else {
          console.log(
            "🚨 Could not locate GraphQL variables in execution context"
          );
          // Log available properties to debug
          console.log("🔍 Available info properties:", Object.keys(info));
          console.log("🔍 Available context properties:", Object.keys(context));
        }
      }

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

      // STEP 1.5: Special handling for GraphQL variables that might have been updated by exports
      if (args && typeof args === "object" && context._graphqlVariables) {
        // Check if any args contain values that might be GraphQL variables that were updated
        // Pass the context directly for export store access
        const infoWithContext = { ...info, context };
        resolvedArgs = await resolveGraphQLVariables(
          resolvedArgs,
          context._graphqlVariables,
          infoWithContext
        );
      }

      // STEP 2: Execute the resolver with resolved arguments
      const result = await next(source, resolvedArgs, context, info);

      // STEP 3: Store exported values from the result
      const fieldNode = info.fieldNodes[0];
      if (!fieldNode) return result;

      // Process exports SYNCHRONOUSLY to ensure they complete before other resolvers start
      await processExportsSync(result, fieldNode, exportStore, context);

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

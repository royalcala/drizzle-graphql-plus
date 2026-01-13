import { GraphQLResolveInfo } from "graphql";
import { SerialExecutor } from "./SerialExecutor";
import {
  hasSerialDirective,
  getParentFieldPath,
  isRootField,
  logSerialExecution,
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
 * Create serial middleware that wraps resolvers to handle @serial directive
 *
 * This middleware:
 * 1. Checks if the operation has @serial directive
 * 2. If enabled, queues field execution to run sequentially within the same parent
 * 3. Root-level fields execute sequentially, nested fields execute sequentially within their parent
 *
 * @returns Middleware function for resolver composition
 */
export function createSerialMiddleware(): ResolverMiddleware {
  return (next: ResolverFn) => {
    return async (
      source: any,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      // Initialize SerialExecutor in context if not already present
      if (!context.serialExecutor) {
        context.serialExecutor = new SerialExecutor();
      }

      const serialExecutor = context.serialExecutor as SerialExecutor;

      // Check if this operation has @serial directive
      const shouldExecuteSerially = hasSerialDirective(info);

      if (shouldExecuteSerially && !serialExecutor.isSerialEnabled()) {
        serialExecutor.enable();
        logSerialExecution("Serial execution enabled for operation", info);
      }

      // If serial execution is not enabled, execute normally
      if (!serialExecutor.isSerialEnabled()) {
        return next(source, args, context, info);
      }

      // Determine the parent path for queuing
      const parentPath = getParentFieldPath(info);
      const isRoot = isRootField(info);

      logSerialExecution("Queuing resolver execution", info, {
        parentPath,
        isRoot,
        fieldName: info.fieldName,
      });

      // Queue the resolver execution
      const resolverPromise = () => {
        logSerialExecution("Executing resolver", info);
        return Promise.resolve(next(source, args, context, info));
      };

      try {
        const result = await serialExecutor.queueResolver(
          parentPath,
          resolverPromise
        );
        logSerialExecution("Resolver execution completed", info);
        return result;
      } catch (error) {
        logSerialExecution("Resolver execution failed", info, { error });
        throw error;
      }
    };
  };
}

/**
 * Create resolver map with serial middleware applied
 * This is an alternative to using composeResolvers
 *
 * @param resolvers - Original resolver map
 * @returns Resolver map with serial middleware applied
 */
export function createSerialResolverMap(resolvers: any): any {
  const serialMiddleware = createSerialMiddleware();
  const wrappedResolvers: any = {};

  // Apply middleware to all resolvers
  for (const typeName in resolvers) {
    wrappedResolvers[typeName] = {};
    for (const fieldName in resolvers[typeName]) {
      const originalResolver = resolvers[typeName][fieldName];
      if (typeof originalResolver === "function") {
        wrappedResolvers[typeName][fieldName] =
          serialMiddleware(originalResolver);
      } else {
        wrappedResolvers[typeName][fieldName] = originalResolver;
      }
    }
  }

  return wrappedResolvers;
}

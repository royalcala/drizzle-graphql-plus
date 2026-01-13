import type { Plugin } from "@envelop/core";
import {
  execute as defaultExecute,
  GraphQLFieldResolver,
  GraphQLObjectType,
} from "graphql";
import {
  hasSerialDirective,
  createSerialExecutor,
  logSerialExecution,
} from "./utils";

/**
 * Envelop plugin that enables @serial directive support
 *
 * When a query has the @serial directive, this plugin ensures that
 * all root-level fields execute sequentially instead of in parallel.
 *
 * @example
 * ```typescript
 * import { envelop } from '@envelop/core';
 * import { useSerialDirective } from 'drizzle-graphql-plus/serial-envelop-hooks';
 *
 * const getEnveloped = envelop({
 *   plugins: [
 *     useEngine({ execute, subscribe, parse }),
 *     useSchema(schema),
 *     useSerialDirective(), // Add this plugin
 *   ],
 * });
 * ```
 */
const processedSchemas = new WeakSet<any>();

export const useSerialDirective = (): Plugin => {
  return {
    onExecute({ args }) {
      // Check if the operation has @serial directive
      const shouldExecuteSerially = hasSerialDirective(
        args.document,
        args.operationName || undefined
      );

      if (!shouldExecuteSerially) {
        // No @serial directive, execute normally
        return undefined;
      }

      logSerialExecution("Serial execution enabled for operation", {
        operationName: args.operationName,
      });

      // Initialize context if needed
      if (!args.contextValue) {
        args.contextValue = {};
      }
      const context = args.contextValue as any;

      // Create a serial executor for this operation and attach to context
      if (!context.serialExecutor) {
        context.serialExecutor = createSerialExecutor();
      }

      // Helper to create wrapped resolver
      const createWrappedResolver = (
        originalResolver: GraphQLFieldResolver<any, any> | undefined
      ): GraphQLFieldResolver<any, any> => {
        return (source, fieldArgs, fieldContext, info) => {
          const ctx = fieldContext as any;
          const serialExecutor = ctx.serialExecutor;

          // Only serialize root-level fields
          const isRootField =
            !info.path.prev || info.path.prev.key === undefined;

          if (!isRootField || !serialExecutor) {
            // Let nested fields execute normally
            if (originalResolver) {
              return originalResolver(source, fieldArgs, fieldContext, info);
            }
            const fieldName = info.fieldName;
            return source?.[fieldName];
          }

          logSerialExecution("Queuing root field for serial execution", {
            field: `${info.parentType.name}.${info.fieldName}`,
          });

          // Queue the resolver execution
          return serialExecutor.enqueue(async () => {
            logSerialExecution("Executing root field", {
              field: `${info.parentType.name}.${info.fieldName}`,
            });

            let result;
            if (originalResolver) {
              result = await originalResolver(
                source,
                fieldArgs,
                fieldContext,
                info
              );
            } else {
              const fieldName = info.fieldName;
              result = source?.[fieldName];
            }

            logSerialExecution("Root field execution completed", {
              field: `${info.parentType.name}.${info.fieldName}`,
            });

            return result;
          });
        };
      };

      // Wrap schema resolvers if NOT already processed
      if (args.schema && !processedSchemas.has(args.schema)) {
        processedSchemas.add(args.schema);
        logSerialExecution("Wrapping schema resolvers for @serial support");

        const typeMap = args.schema.getTypeMap();
        for (const typeName in typeMap) {
          const type = typeMap[typeName];
          // Technically @serial typically applies to Mutation/Query root types only,
          // but we can wrap all ObjectTypes to be safe and let isRootField check handle it.
          // Or we can optimize by only wrapping Query/Mutation types if we knew them.
          // For now, consistent with Export plugin, wrap all ObjectTypes.
          if (type instanceof GraphQLObjectType && !typeName.startsWith("__")) {
            const fields = type.getFields();
            for (const fieldName in fields) {
              const field = fields[fieldName];
              if (!field) {
                continue;
              }
              if (field.resolve) {
                field.resolve = createWrappedResolver(field.resolve);
              }
            }
          }
        }
      }

      // Set the custom field resolver as fallback via args.fieldResolver
      // (compatible with other plugins modification)
      args.fieldResolver = createWrappedResolver(args.fieldResolver);

      return {
        onExecuteDone() {
          logSerialExecution("Serial execution completed", {
            operationName: args.operationName,
          });
        },
      };
    },
  };
};

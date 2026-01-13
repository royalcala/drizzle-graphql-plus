import type { Plugin } from "@envelop/core";
import {
  GraphQLFieldResolver,
  execute as defaultExecute,
  getArgumentValues,
  GraphQLObjectType,
} from "graphql";
import { ExportStore } from "./ExportStore";
import {
  logExportExecution,
  resolveExportVariables,
  resolveGraphQLVariables,
  hasExportVariables,
  getExportDirective,
  processExports,
  normalizeFilterOperators,
} from "./utils";

const processedSchemas = new WeakSet<any>();

export const useExportDirective = (): Plugin => {
  return {
    onExecute({ args, setExecuteFn }) {
      // Initialize ExportStore in context
      if (!args.contextValue) {
        args.contextValue = {};
      }

      const context = args.contextValue as any;

      if (!context.exportStore) {
        context.exportStore = new ExportStore();
        logExportExecution("Created new ExportStore in context");
      }

      const exportStore = context.exportStore as ExportStore;

      // Store reference to GraphQL variables for updates
      const initialVariables = args.variableValues || {};
      if (!context._graphqlVariables) {
        context._graphqlVariables = { ...initialVariables };
        logExportExecution(
          "Stored GraphQL variables reference",
          Object.keys(initialVariables)
        );
      }

      // Helper function to create a wrapped resolver
      const createWrappedResolver = (
        originalResolver: GraphQLFieldResolver<any, any> | undefined
      ): GraphQLFieldResolver<any, any> => {
        return async (source, fieldArgs, fieldContext, info) => {
          // Use the shared context (args.contextValue is passed as fieldContext here usually)
          const ctx = fieldContext as any;
          const store = ctx.exportStore as ExportStore;

          const isComments =
            info.fieldName === "comments" ||
            info.fieldName === "commentFindMany";

          if (isComments) {
            logExportExecution("DEBUG Resolver Called", {
              fieldName: info.fieldName,
              args: JSON.stringify(fieldArgs),
              variables: JSON.stringify(ctx._graphqlVariables),
            });
          }

          // STEP 0: Re-resolve arguments
          let currentArgs = fieldArgs;
          if (
            ctx._graphqlVariables &&
            info.parentType instanceof GraphQLObjectType
          ) {
            const fieldNode = info.fieldNodes[0];
            if (!fieldNode) {
              if (isComments) {
                logExportExecution("DEBUG fieldNode NOT FOUND");
              }
            } else {
              const fieldName = fieldNode.name.value;
              const fieldDef = info.parentType.getFields()[fieldName];

              // Log if fieldDef found
              if (isComments && !fieldDef) {
                logExportExecution("DEBUG fieldDef NOT FOUND");
              }

              if (fieldDef) {
                try {
                  if (isComments) {
                    logExportExecution("DEBUG calling getArgumentValues", {
                      fieldNodeName: fieldNode.name.value,
                      fieldDefName: fieldDef.name,
                      variablesKeys: Object.keys(ctx._graphqlVariables || {}),
                    });
                  }

                  const freshArgs = getArgumentValues(
                    fieldDef,
                    fieldNode,
                    ctx._graphqlVariables
                  );

                  if (isComments) {
                    logExportExecution("DEBUG getArgumentValues result", {
                      freshArgsKeys: Object.keys(freshArgs || {}),
                      freshArgs: JSON.stringify(freshArgs),
                    });
                  }

                  if (freshArgs) {
                    currentArgs = freshArgs;
                  }
                } catch (e) {
                  logExportExecution(
                    "Failed to re-resolve args for " + info.fieldName,
                    e
                  );
                }
              }
            }
          }

          // STEP 1: Resolve export variables
          let resolvedArgs = currentArgs;
          const fieldNode = info.fieldNodes[0];

          if (currentArgs && typeof currentArgs === "object") {
            if (fieldNode) {
              try {
                await resolveGraphQLVariables(
                  currentArgs,
                  fieldNode,
                  store,
                  10000
                );
              } catch (error) {
                logExportExecution("GraphQL variable resolution failed", error);
              }
            }

            // Normalize filter operator names so that GraphQL-style
            // inputs like `{ in: [...] }` are transformed into the
            // Drizzle-ready `{ inArray: [...] }` form before the
            // underlying resolvers build SQL where clauses.
            normalizeFilterOperators(currentArgs);

            if (hasExportVariables(currentArgs)) {
              try {
                resolvedArgs = await resolveExportVariables(
                  currentArgs,
                  store,
                  10000
                );
              } catch (error) {
                throw new Error(
                  "Export variable resolution failed in " +
                    info.parentType.name +
                    "." +
                    info.fieldName +
                    ": " +
                    (error instanceof Error ? error.message : String(error))
                );
              }
            }
          }

          // STEP 2: Execute original or default resolver
          let result;
          if (originalResolver) {
            result = await originalResolver(
              source,
              resolvedArgs,
              fieldContext,
              info
            );
          } else {
            const fieldName = info.fieldName;
            result = source?.[fieldName];
          }

          // STEP 3: Store exported values
          if (fieldNode) {
            const selfExportName = getExportDirective(fieldNode);
            if (selfExportName && result !== undefined && result !== null) {
              if (!fieldNode.selectionSet) {
                logExportExecution(
                  "Setting field-level export: " + selfExportName,
                  { value: result }
                );
                store.set(selfExportName, result);

                if (selfExportName.startsWith("$_")) {
                  const varName = "_" + selfExportName.slice(2);
                  if (ctx._graphqlVariables) {
                    const currentVal = ctx._graphqlVariables[varName];
                    if (Array.isArray(currentVal)) {
                      if (!currentVal.includes(result) && result !== "") {
                        currentVal.push(result);
                      }
                    } else {
                      ctx._graphqlVariables[varName] = result;
                    }
                    logExportExecution(
                      "Updated GraphQL variable: " + varName,
                      ctx._graphqlVariables[varName]
                    );
                  }
                }
              }
            }

            if (
              fieldNode &&
              fieldNode.selectionSet &&
              result !== undefined &&
              result !== null
            ) {
              if (Array.isArray(result)) {
                result.forEach((item) => {
                  if (item && typeof item === "object") {
                    processExports(
                      item,
                      fieldNode.selectionSet!,
                      store,
                      ctx._graphqlVariables,
                      true
                    );
                  }
                });
              } else if (typeof result === "object") {
                processExports(
                  result,
                  fieldNode.selectionSet!,
                  store,
                  ctx._graphqlVariables,
                  false
                );
              }
            }
          }

          return result;
        };
      };

      // Wrap schema resolvers if NOT already processed
      // This handles explicit resolvers (Root fields)
      if (args.schema && !processedSchemas.has(args.schema)) {
        processedSchemas.add(args.schema);
        logExportExecution("Wrapping schema resolvers");

        const typeMap = args.schema.getTypeMap();
        for (const typeName in typeMap) {
          const type = typeMap[typeName];
          if (type instanceof GraphQLObjectType && !typeName.startsWith("__")) {
            const fields = type.getFields();
            for (const fieldName in fields) {
              const field = fields[fieldName];
              if (!field) {
                continue;
              }
              if (field.resolve) {
                // Wrap existing resolver
                field.resolve = createWrappedResolver(field.resolve);
              }
            }
          }
        }
      }

      // Set the custom field resolver as fallback for fields WITHOUT explicit resolvers (Leaf fields)
      // We modify args.fieldResolver directly instead of using setExecuteFn to avoid overriding
      // other plugins (like useSerialDirective) that might set a custom executor.
      args.fieldResolver = createWrappedResolver(args.fieldResolver);

      return {
        onExecuteDone() {
          logExportExecution("Export execution completed", {
            exports: exportStore.getAll(),
            variables: context._graphqlVariables || {},
          });
        },
      };
    },
  };
};

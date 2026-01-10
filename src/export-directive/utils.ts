import { GraphQLResolveInfo, FieldNode, DirectiveNode } from "graphql";
import { ExportStore } from "./ExportStore";

/**
 * Resolve GraphQL variables that may have been updated during export processing
 */
export async function resolveGraphQLVariables(
  args: any,
  graphqlVariables: Record<string, any>,
  info: GraphQLResolveInfo
): Promise<any> {
  // console.log(`🔍 Checking args for GraphQL variable resolution in ${info.fieldName}`);
  // console.log(`🔍 Current GraphQL variables:`, graphqlVariables);
  // console.log(`🔍 Args to check:`, args);

  // If args contains array with empty string that matches a default GraphQL variable,
  // check if we have an updated value
  if (Array.isArray(args)) {
    return Promise.all(
      args.map((item) => resolveGraphQLVariables(item, graphqlVariables, info))
    );
  }

  if (typeof args === "object" && args !== null) {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      // Check if this value looks like a default GraphQL variable value that might have been updated
      if (Array.isArray(value) && value.length === 1 && value[0] === "") {
        // Look for a corresponding updated variable in graphqlVariables
        // Common pattern: inArray: [""] where the variable was updated
        // console.log(`🔍 Found potential GraphQL variable default for key ${key}:`, value);

        // First check if we have updated variables
        let foundUpdatedVariable = false;
        for (const [varName, varValue] of Object.entries(graphqlVariables)) {
          if (
            Array.isArray(varValue) &&
            varValue.length > 0 &&
            varValue[0] !== ""
          ) {
            console.log(`🔍 Found updated variable ${varName}:`, varValue);
            resolved[key] = varValue;
            foundUpdatedVariable = true;
            break;
          }
        }

        // If no updated variable found but we expect exports, wait for them
        if (
          !foundUpdatedVariable &&
          info.parentType &&
          (info.parentType.name === "Query" ||
            info.parentType.name === "Mutation")
        ) {
          // console.log(`🔍 No updated variables yet, parent type: ${info.parentType.name}`);

          // Check if there's an export store in context and wait for exports
          const context = (info as any).context || {};
          // console.log(`🔍 Context available:`, !!context);
          // console.log(`🔍 Export store available:`, !!context.exportStore);

          if (context.exportStore) {
            console.log(
              `🔍 No updated variables yet, checking for pending exports...`
            );

            // Look for likely export variable names based on the GraphQL variable names
            // Example: _authorIds variable might correspond to $_authorIds export
            const potentialExports = Object.keys(graphqlVariables).map(
              (varName) =>
                varName.startsWith("_") ? `$${varName}` : `$_${varName}`
            );

            console.log(
              `🔍 Potential export names to wait for:`,
              potentialExports
            );

            // Try to wait for the most likely export
            for (const exportName of potentialExports) {
              try {
                // console.log(`🔍 Waiting for export: ${exportName}`);
                const exportedValue = await context.exportStore.waitFor(
                  exportName,
                  2000,
                  false
                );
                if (
                  exportedValue &&
                  Array.isArray(exportedValue) &&
                  exportedValue.length > 0
                ) {
                  console.log(
                    `✅ Found exported value for ${exportName}:`,
                    exportedValue
                  );
                  resolved[key] = exportedValue;
                  foundUpdatedVariable = true;
                  break;
                }
              } catch (error) {
                console.log(
                  `⚠️ Export ${exportName} not available yet:`,
                  error.message
                );
              }
            }
          } else {
            console.log(
              `🚨 No export store available in context to wait for exports`
            );
          }
        } else {
          // console.log(`🔍 Conditions for waiting: foundUpdatedVariable=${foundUpdatedVariable}, parentType=${info.parentType?.name}`);
        }

        // If still no updated variable found, keep original value
        if (!(key in resolved)) {
          resolved[key] = value;
        }
      } else if (typeof value === "object" && value !== null) {
        resolved[key] = await resolveGraphQLVariables(
          value,
          graphqlVariables,
          info
        );
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  return args;
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
 * With @serial directive, we can rely on proper execution order for variable resolution
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

        // Special handling for OR with array values - convert to proper OR structure
        if (key === "OR" && Array.isArray(resolvedValue)) {
          // Convert ["id1", "id2", "id3"] to [{ id: { eq: "id1" } }, { id: { eq: "id2" } }, { id: { eq: "id3" } }]
          resolved[key] = resolvedValue.map((id) => ({ id: { eq: id } }));
        } else {
          resolved[key] = resolvedValue;
        }
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
 * Returns the export name if directive exists, otherwise undefined
 */
export function getExportDirective(fieldNode: FieldNode): string | null {
  const node = fieldNode;

  if (!node || !node.directives) {
    return null;
  }

  // Find @export directive
  const exportDirective = node.directives.find(
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
 * Extract export directives from all selected fields
 * Returns a map of field names to export names
 */
export function extractExportDirectives(
  info: GraphQLResolveInfo
): Map<string, string> {
  const exports = new Map<string, string>();

  // Get the selection set from the field
  const fieldNode = info.fieldNodes[0];
  if (!fieldNode || !fieldNode.selectionSet) {
    return exports;
  }

  // Iterate through selected fields
  for (const selection of fieldNode.selectionSet.selections) {
    if (selection.kind === "Field") {
      const exportName = getExportDirective(selection);
      if (exportName) {
        const fieldName = selection.name.value;
        exports.set(fieldName, exportName);
      }
    }
  }

  return exports;
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
 * Synchronous version of export processing to ensure exports complete before resolver returns
 */
export async function processExportsSync(
  result: any,
  fieldNode: FieldNode,
  exportStore: ExportStore,
  context?: any
): Promise<void> {
  if (!result || !fieldNode) return;

  // console.log(
  //   "🔧 Processing exports SYNCHRONOUSLY for result:",
  //   typeof result,
  //   Array.isArray(result) ? `array[${result.length}]` : "single"
  // );
  // console.log(
  //   "🔧 Checking field node for @export directive:",
  //   fieldNode.name.value
  // );

  // Check if the field itself has @export directive
  const selfExportName = getExportDirective(fieldNode);
  if (selfExportName && result !== undefined && result !== null) {
    // console.log(
    //   "🔧 Found @export directive on field itself:",
    //   selfExportName
    // );
    // Only set if there's no nested selection set - let processExports handle nested exports
    if (!fieldNode.selectionSet) {
      // console.log(
      //   "🔧 Setting field-level export:",
      //   selfExportName,
      //   "=",
      //   result
      // );
      exportStore.set(selfExportName, result);
    } else {
      // console.log(
      //   "🔧 Field has selection set, will process nested exports"
      // );
    }
  } else {
    // console.log("🔧 No @export directive found on field itself");
  }

  // Process nested exports (recursively) via selection set
  if (fieldNode.selectionSet && result !== undefined && result !== null) {
    // console.log("🔧 Processing nested exports in selection set SYNCHRONOUSLY");
    if (Array.isArray(result)) {
      // console.log(
      //   `🔧 Processing ${result.length} array items for nested exports`
      // );
      result.forEach((item, index) => {
        if (item && typeof item === "object") {
          // console.log(`🔧 Processing array item ${index} for exports`);
          processExports(
            item,
            fieldNode.selectionSet!,
            exportStore,
            true,
            context
          );
        }
      });
    } else if (typeof result === "object") {
      // console.log("🔧 Processing single object for nested exports");
      processExports(
        result,
        fieldNode.selectionSet,
        exportStore,
        false,
        context
      );
    }
  } else {
    // console.log("🔧 No selection set to process for nested exports");
  }

  // Debug: Show current export store state after sync processing
  // console.log(
  //   "🔧 Export store keys after SYNC processing:",
  //   Object.keys((exportStore as any).store || {})
  // );
}

/**
 * Recursively process result object against selection set to find and store exports
 * @param result The result object from the resolver
 * @param selectionSet The GraphQL selection set
 * @param exportStore The export store to store values
 * @param isArrayItem True if this result is an item from an array (enables accumulation)
 * @param context Optional context to access execution context for GraphQL variable updates
 */
export function processExports(
  result: any,
  selectionSet: import("graphql").SelectionSetNode,
  exportStore: ExportStore,
  isArrayItem = false,
  context?: any
): void {
  // console.log("🔧 processExports called with:", {
  //   resultType: typeof result,
  //   isArrayItem,
  //   selectionsCount: selectionSet.selections.length,
  // });

  if (!result || !selectionSet) return;

  for (const selection of selectionSet.selections) {
    if (selection.kind !== "Field") continue;

    // Handle aliases: result key is alias if present, otherwise field name
    const resultKey = selection.alias?.value ?? selection.name.value;
    // console.log(
    //   "🔧 Processing selection:",
    //   selection.name.value,
    //   "as key:",
    //   resultKey
    // );

    // Skip if field is not in result (e.g. was not fetched or skipped)
    if (!(resultKey in result)) {
      // console.log("🔧 Field not in result, skipping");
      continue;
    }

    const value = result[resultKey];
    console.log(
      "🔧 Field value:",
      typeof value,
      Array.isArray(value) ? `array[${value.length}]` : "single"
    );

    // 1. Check for @export on this field
    const exportName = getExportDirective(selection);
    if (exportName) {
      // console.log(
      //   `🔧 Found @export directive: ${exportName}, isArrayItem: ${isArrayItem}`
      // );

      // If exportName starts with "$_", it's a GraphQL variable
      if (exportName.startsWith("$_")) {
        const varName = exportName.slice(2); // Remove $_
        const fullVarName = `_${varName}`; // GraphQL variable names have _ prefix
        console.log(
          `🔧 Updating GraphQL variable '${fullVarName}' with value:`,
          value
        );

        // Update GraphQL execution context variables
        if (context && context._graphqlVariables) {
          const variableValues = context._graphqlVariables;
          console.log(`🔍 Current variables before update:`, variableValues);

          // Clear the default empty string if it exists
          if (
            Array.isArray(variableValues[fullVarName]) &&
            variableValues[fullVarName].length === 1 &&
            variableValues[fullVarName][0] === ""
          ) {
            variableValues[fullVarName] = [];
          }

          if (isArrayItem) {
            // Accumulate values for array items
            if (Array.isArray(variableValues[fullVarName])) {
              variableValues[fullVarName] = [
                ...variableValues[fullVarName],
                value,
              ];
            } else {
              variableValues[fullVarName] = [value];
            }
          } else {
            // Set single value or replace array completely
            if (Array.isArray(value)) {
              variableValues[fullVarName] = value;
            } else {
              variableValues[fullVarName] = [value];
            }
          }

          console.log(
            `✅ Updated GraphQL variable '${fullVarName}' to:`,
            variableValues[fullVarName]
          );
        } else {
          console.log(
            `⚠️ Could not access GraphQL variables to update '${fullVarName}'`
          );
        }

        // Also store in exportStore as fallback
        if (isArrayItem) {
          exportStore.accumulate(exportName, value);
        } else {
          exportStore.set(exportName, value);
        }
      } else {
        // Regular export to ExportStore
        if (isArrayItem) {
          // console.log(`🔧 Accumulating ${exportName} with value:`, value);
          exportStore.accumulate(exportName, value);
        } else {
          console.log(`🔧 Setting ${exportName} with value:`, value);
          exportStore.set(exportName, value);
        }
      }
    } else {
      // console.log("🔧 No @export directive found on field");
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
              true,
              context
            );
          }
        });
      } else if (typeof value === "object") {
        // Keep isArrayItem flag for nested objects within array items
        processExports(
          value,
          selection.selectionSet,
          exportStore,
          isArrayItem,
          context
        );
      }
    }
  }
}

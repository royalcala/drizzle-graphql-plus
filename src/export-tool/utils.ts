import { GraphQLResolveInfo, FieldNode, DirectiveNode } from "graphql";
import { ExportStore } from "./ExportStore";

/**
 * Check if a value is a string that starts with $_ (export variable pattern)
 */
export function isExportVariable(value: any): value is string {
  return (
    typeof value === "string" && value.startsWith("$_") && value.length > 2
  );
}

/**
 * Extract variable name from export pattern (e.g., "$_userId" -> "userId")
 */
export function getVariableName(value: string): string | null {
  if (!isExportVariable(value)) {
    return null;
  }
  return value.slice(2); // Remove $_
}

/**
 * Recursively resolve export variables in arguments
 * Handles nested objects, arrays, and primitive values
 */
export async function resolveExportVariables(
  args: any,
  exportStore: ExportStore,
  timeout?: number
): Promise<any> {
  // Handle primitive export variables
  if (isExportVariable(args)) {
    const varName = getVariableName(args)!;
    return await exportStore.waitFor(varName, timeout);
  }

  // Handle arrays
  if (Array.isArray(args)) {
    const resolved = await Promise.all(
      args.map(async (item) => {
        if (isExportVariable(item)) {
          const varName = getVariableName(item)!;
          return await exportStore.waitFor(varName, timeout);
        } else if (typeof item === "object" && item !== null) {
          return await resolveExportVariables(item, exportStore, timeout);
        }
        return item;
      })
    );
    return resolved;
  }

  // Handle objects
  if (typeof args === "object" && args !== null) {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      if (isExportVariable(value)) {
        const varName = getVariableName(value)!;
        resolved[key] = await exportStore.waitFor(varName, timeout);
      } else if (Array.isArray(value)) {
        resolved[key] = await resolveExportVariables(
          value,
          exportStore,
          timeout
        );
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

  // Return primitive values as-is
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
  if (!fieldNode.selectionSet) {
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
 * Recursively process result object against selection set to find and store exports
 */
export function processExports(
  result: any,
  selectionSet: import("graphql").SelectionSetNode,
  exportStore: ExportStore
): void {
  if (!result || !selectionSet) return;

  for (const selection of selectionSet.selections) {
    if (selection.kind !== "Field") continue;

    // Handle aliases: result key is alias if present, otherwise field name
    const resultKey = selection.alias?.value ?? selection.name.value;

    // Skip if field is not in result (e.g. was not fetched or skipped)
    if (!(resultKey in result)) continue;

    const value = result[resultKey];

    // 1. Check for @export on this field
    const exportName = getExportDirective(selection);
    if (exportName) {
      exportStore.set(exportName, value);
    }

    // 2. Recurse if nested selection exists and value is traversable
    if (selection.selectionSet && value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === "object") {
            processExports(item, selection.selectionSet!, exportStore);
          }
        });
      } else if (typeof value === "object") {
        processExports(value, selection.selectionSet, exportStore);
      }
    }
  }
}

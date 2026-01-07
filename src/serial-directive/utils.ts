import {
  FieldNode,
  GraphQLResolveInfo,
  OperationDefinitionNode,
} from "graphql";

/**
 * Check if an operation has the @serial directive
 * @param info - GraphQL resolve info
 * @returns true if the operation has @serial directive
 */
export function hasSerialDirective(info: GraphQLResolveInfo): boolean {
  const operation = info.operation;
  return (
    operation.directives?.some(
      (directive) => directive.name.value === "serial"
    ) || false
  );
}

/**
 * Get the field path from GraphQL resolve info
 * @param info - GraphQL resolve info
 * @returns The field path as a string
 */
export function getFieldPath(info: GraphQLResolveInfo): string {
  const path = [];
  let currentPath = info.path;

  while (currentPath) {
    if (typeof currentPath.key === "string") {
      path.unshift(currentPath.key);
    }
    currentPath = currentPath.prev;
  }

  return path.join(".");
}

/**
 * Get the parent field path from GraphQL resolve info
 * @param info - GraphQL resolve info
 * @returns The parent field path as a string
 */
export function getParentFieldPath(info: GraphQLResolveInfo): string {
  const path = [];
  let currentPath = info.path.prev; // Skip current field

  while (currentPath) {
    if (typeof currentPath.key === "string") {
      path.unshift(currentPath.key);
    }
    currentPath = currentPath.prev;
  }

  return path.join(".") || "root";
}

/**
 * Check if the current field is a root-level field
 * @param info - GraphQL resolve info
 * @returns true if the field is at root level
 */
export function isRootField(info: GraphQLResolveInfo): boolean {
  return !info.path.prev || info.path.prev.key === undefined;
}

/**
 * Get operation type from GraphQL resolve info
 * @param info - GraphQL resolve info
 * @returns The operation type (query, mutation, subscription)
 */
export function getOperationType(
  info: GraphQLResolveInfo
): "query" | "mutation" | "subscription" {
  return info.operation.operation;
}

/**
 * Log serial execution information for debugging
 * @param message - The message to log
 * @param info - GraphQL resolve info
 * @param data - Additional data to log
 */
export function logSerialExecution(
  message: string,
  info: GraphQLResolveInfo,
  data?: any
): void {
  if (process.env.DEBUG_SERIAL) {
    const fieldPath = getFieldPath(info);
    const parentPath = getParentFieldPath(info);
    console.log(`[SERIAL] ${message}`, {
      field: `${info.parentType.name}.${info.fieldName}`,
      fieldPath,
      parentPath,
      operation: info.operation.operation,
      data,
    });
  }
}

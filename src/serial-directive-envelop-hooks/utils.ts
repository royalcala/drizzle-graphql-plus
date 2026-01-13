import { DocumentNode, OperationDefinitionNode } from "graphql";

/**
 * Check if a GraphQL document has the @serial directive on any operation
 * @param document - Parsed GraphQL document
 * @param operationName - Optional operation name to check
 * @returns true if the operation has @serial directive
 */
export function hasSerialDirective(
    document: DocumentNode,
    operationName?: string
): boolean {
    // Find the operation definition
    const operation = document.definitions.find((def) => {
        if (def.kind !== "OperationDefinition") return false;
        const opDef = def as OperationDefinitionNode;

        // If operationName is specified, match it
        if (operationName) {
            return opDef.name?.value === operationName;
        }

        // Otherwise, use the first operation (or the only one if unnamed)
        return true;
    }) as OperationDefinitionNode | undefined;

    if (!operation) return false;

    // Check if the operation has @serial directive
    return (
        operation.directives?.some(
            (directive) => directive.name.value === "serial"
        ) || false
    );
}

/**
 * Simple serial executor that queues promises to run sequentially
 */
export class SerialExecutor {
    private queue: Promise<any> = Promise.resolve();

    /**
     * Add a task to the execution queue
     * @param task - Function that returns a promise
     * @returns Promise that resolves when the task completes
     */
    enqueue<T>(task: () => Promise<T>): Promise<T> {
        const promise = this.queue.then(task, task);
        this.queue = promise.then(
            () => { },
            () => { }
        ); // Catch errors to prevent queue from breaking
        return promise;
    }

    /**
     * Reset the queue
     */
    reset(): void {
        this.queue = Promise.resolve();
    }
}

/**
 * Create a new serial executor instance
 * @returns A new SerialExecutor
 */
export function createSerialExecutor(): SerialExecutor {
    return new SerialExecutor();
}

/**
 * Log serial execution information for debugging
 * @param message - The message to log
 * @param data - Additional data to log
 */
export function logSerialExecution(message: string, data?: any): void {
    if (process.env.DEBUG_SERIAL) {
        console.log(`[SERIAL-HOOK] ${message}`, data || "");
    }
}

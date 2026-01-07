/**
 * Serial Executor for managing sequential field execution
 */

export class SerialExecutor {
  private executionQueue: Map<string, Promise<any>[]> = new Map();
  private isEnabled: boolean = false;

  /**
   * Enable serial execution for the current operation
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disable serial execution for the current operation
   */
  disable(): void {
    this.isEnabled = false;
    this.executionQueue.clear();
  }

  /**
   * Check if serial execution is enabled
   */
  isSerialEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Add a resolver promise to the execution queue
   * @param parentPath - The path of the parent field
   * @param resolverPromise - The resolver promise to queue
   */
  queueResolver<T>(
    parentPath: string,
    resolverPromise: () => Promise<T>
  ): Promise<T> {
    if (!this.isEnabled) {
      // If serial execution is disabled, execute immediately
      return resolverPromise();
    }

    // Get or create the queue for this parent path
    const queue = this.executionQueue.get(parentPath) || [];

    // Create a promise that waits for all previous promises in the queue to complete
    const serialPromise =
      queue.length > 0
        ? queue[queue.length - 1].then(() => resolverPromise())
        : resolverPromise();

    // Add this promise to the queue
    queue.push(serialPromise);
    this.executionQueue.set(parentPath, queue);

    return serialPromise;
  }

  /**
   * Wait for all queued resolvers in a specific path to complete
   * @param parentPath - The path to wait for
   */
  async waitForPath(parentPath: string): Promise<void> {
    const queue = this.executionQueue.get(parentPath);
    if (queue && queue.length > 0) {
      await Promise.all(queue);
    }
  }

  /**
   * Wait for all queued resolvers to complete
   */
  async waitForAll(): Promise<void> {
    const allQueues = Array.from(this.executionQueue.values());
    const allPromises = allQueues.flat();
    if (allPromises.length > 0) {
      await Promise.all(allPromises);
    }
  }

  /**
   * Clear the execution queue for a specific path
   * @param parentPath - The path to clear
   */
  clearPath(parentPath: string): void {
    this.executionQueue.delete(parentPath);
  }

  /**
   * Clear all execution queues
   */
  clearAll(): void {
    this.executionQueue.clear();
  }
}

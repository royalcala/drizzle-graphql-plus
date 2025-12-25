/**
 * ExportStore - Manages exported values with Promise-based synchronization
 *
 * This store allows resolvers to:
 * 1. Export values by calling set(name, value)
 * 2. Wait for exported values by calling waitFor(name)
 *
 * The waitFor method returns a Promise that resolves when the value is available,
 * enabling coordination between sibling resolvers in a GraphQL query.
 */

export class ExportStore {
  private store: Map<string, any> = new Map();
  private pending: Map<string, Array<(value: any) => void>> = new Map();

  /**
   * Store a value for later retrieval
   * Resolves any pending promises waiting for this value
   */
  set(name: string, value: any): void {
    this.store.set(name, value);

    // Resolve any pending promises waiting for this value
    const callbacks = this.pending.get(name);
    if (callbacks) {
      callbacks.forEach((resolve) => resolve(value));
      this.pending.delete(name);
    }
  }

  /**
   * Get a value if it exists, otherwise return undefined
   */
  get(name: string): any | undefined {
    return this.store.get(name);
  }

  /**
   * Wait for a value to be available
   * Returns immediately if value already exists
   * Returns a Promise that resolves when value is set
   */
  async waitFor(name: string, timeout = 5000): Promise<any> {
    // If value already exists, return it immediately
    if (this.store.has(name)) {
      return this.store.get(name);
    }

    // Otherwise, create a promise that will be resolved when value is set
    return new Promise((resolve, reject) => {
      // Add callback to pending list
      if (!this.pending.has(name)) {
        this.pending.set(name, []);
      }
      this.pending.get(name)!.push(resolve);

      // Set timeout to prevent infinite waiting
      setTimeout(() => {
        const callbacks = this.pending.get(name);
        if (callbacks) {
          const index = callbacks.indexOf(resolve);
          if (index > -1) {
            callbacks.splice(index, 1);
            reject(new Error(`Timeout waiting for export variable "${name}"`));
          }
        }
      }, timeout);
    });
  }

  /**
   * Check if a value has been set
   */
  has(name: string): boolean {
    return this.store.has(name);
  }

  /**
   * Clear all stored values
   */
  clear(): void {
    this.store.clear();
    this.pending.clear();
  }

  /**
   * Get all stored values
   */
  getAll(): Record<string, any> {
    return Object.fromEntries(this.store.entries());
  }
}

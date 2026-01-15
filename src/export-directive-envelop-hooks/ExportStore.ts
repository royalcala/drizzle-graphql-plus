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
  private accumulators: Map<string, Set<any>> = new Map();

  /**
   * Store a value for later retrieval
   * Resolves any pending promises waiting for this value
   */
  set(name: string, value: any): void {
    // If we're already accumulating this variable, treat set() as an accumulation
    if (this.accumulators.has(name)) {
      this.accumulate(name, value);
      return;
    }

    this.store.set(name, value);

    // Resolve any pending promises waiting for this value
    const callbacks = this.pending.get(name);
    if (callbacks) {
      callbacks.forEach((resolve) => resolve(value));
      this.pending.delete(name);
    }
  }

  /**
   * Accumulate values into an array with deduplication
   * Works great with @serial directive to build arrays from sequential field exports
   */
  accumulate(name: string, value: any): void {
    // Initialize accumulator set if needed
    if (!this.accumulators.has(name)) {
      const initialSet = new Set();

      // If there's already a value in the store (from a previous set() call),
      // import it into the accumulator so we don't lose it
      if (this.store.has(name)) {
        const existing = this.store.get(name);
        if (existing !== null && existing !== undefined) {
          if (Array.isArray(existing)) {
            existing.forEach(item => initialSet.add(item));
          } else {
            initialSet.add(existing);
          }
        }
      }

      this.accumulators.set(name, initialSet);
    }

    const accumulator = this.accumulators.get(name)!;

    // Add the value to the accumulator (with deduplication via Set)
    if (value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        // If value is an array, add each item individually
        value.forEach((item) => {
          if (item !== null && item !== undefined) {
            accumulator.add(item);
          }
        });
      } else {
        // Single value
        accumulator.add(value);
      }
    }

    // Convert accumulated Set to Array and store it
    const accumulatedArray = Array.from(accumulator);
    this.store.set(name, accumulatedArray);

    // Notify any waiting promises with the current accumulated array
    const callbacks = this.pending.get(name);
    if (callbacks) {
      callbacks.forEach((resolve) => resolve(accumulatedArray));
      // Don't delete pending - more accumulation might happen
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
   * If timeout occurs and allowNull is true, resolves with null instead of rejecting
   */
  async waitFor(name: string, timeout = 5000, allowNull = false): Promise<any> {
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
            if (allowNull) {
              // Resolve with null instead of rejecting
              resolve(null);
            } else {
              reject(
                new Error(`Timeout waiting for export variable "${name}"`)
              );
            }
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
    this.accumulators.clear();
  }

  /**
   * Get all stored values
   */
  getAll(): Record<string, any> {
    return Object.fromEntries(this.store.entries());
  }
}

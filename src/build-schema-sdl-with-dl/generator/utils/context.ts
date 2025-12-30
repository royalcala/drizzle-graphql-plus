import type { DataLoaderContext } from './dataloader';

// Create DataLoader context for GraphQL execution
export function createDataLoaderContext(): DataLoaderContext {
  return {
    relationLoaders: new Map(),
  };
}

// Cleanup function to call at the end of each request
export function cleanupDataLoaderContext(context: DataLoaderContext): void {
  for (const loader of Array.from(context.relationLoaders.values())) {
    loader.clearAll();
  }
  context.relationLoaders.clear();
}

// Middleware to automatically setup and cleanup DataLoader context
export function withDataLoaderContext<T extends any[], R>(
  fn: (context: DataLoaderContext, ...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    const context = createDataLoaderContext();
    try {
      return await fn(context, ...args);
    } finally {
      cleanupDataLoaderContext(context);
    }
  };
}
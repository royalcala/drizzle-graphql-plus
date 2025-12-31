import type { Plugin } from '@envelop/core';
import { createDataLoaderContext, cleanupDataLoaderContext } from './context';
import type { DataLoaderContext } from './dataloader';

/**
 * Envelop plugin that automatically manages DataLoader contexts and database injection.
 * - Creates DataLoader context at the start of each request
 * - Optionally injects database instance into context
 * - Adds both to the GraphQL context
 * - Cleans up after each GraphQL execution
 * 
 * This eliminates the need for manual context setup in your GraphQL server.
 */
export const useDataLoaderCleanup = (options?: { 
  db?: any; // Optional database instance to inject
}): Plugin => ({
  onContextBuilding: ({ context, extendContext }) => {
    // Create DataLoader context and add it to GraphQL context
    const dataLoaderContext = createDataLoaderContext();
    
    // Extend context with DataLoader context and optionally database
    const contextExtension: any = dataLoaderContext;
    
    // If database is provided, inject it into context
    if (options?.db) {
      contextExtension.db = options.db;
    }
    
    extendContext(contextExtension);
  },
  
  onExecute: ({ args }) => ({
    onExecuteDone: () => {
      // Cleanup DataLoaders after request completion
      const context = args.contextValue as any;
      if (context && context.relationLoaders) {
        cleanupDataLoaderContext(context as DataLoaderContext);
      }
    }
  })
});

/**
 * Alternative: Separate plugins for context creation and cleanup
 * Use these if you need more granular control
 */

/**
 * Plugin that creates DataLoader context and optionally injects database
 */
export const useDataLoaderContext = (options?: { 
  db?: any; // Optional database instance to inject
}): Plugin => ({
  onContextBuilding: ({ context, extendContext }) => {
    const dataLoaderContext = createDataLoaderContext();
    
    const contextExtension: any = dataLoaderContext;
    if (options?.db) {
      contextExtension.db = options.db;
    }
    
    extendContext(contextExtension);
  }
});

/**
 * Plugin that only handles DataLoader cleanup
 */
export const useDataLoaderCleanupOnly = (): Plugin => ({
  onExecute: ({ args }) => ({
    onExecuteDone: () => {
      const context = args.contextValue as any;
      if (context && context.relationLoaders) {
        cleanupDataLoaderContext(context as DataLoaderContext);
      }
    }
  })
});
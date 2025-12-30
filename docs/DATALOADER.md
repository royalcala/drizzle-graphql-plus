# DataLoader Integration

This document explains how to use DataLoader with drizzle-graphql-plus to optimize relational queries and eliminate N+1 query problems.

## Overview

DataLoader is a generic utility to batch and cache data loading operations. In the context of GraphQL and Drizzle ORM, it helps optimize relational queries by:

1. **Batching**: Collecting multiple relation requests and executing them as a single database query
2. **Caching**: Avoiding duplicate fetches within the same request
3. **Maintaining Flexibility**: Still supporting `where`, `orderBy`, `limit`, and other query clauses

## Problem Solved

### Without DataLoader (N+1 Problem)
```graphql
query GetPostsWithComments {
  postFindMany(limit: 10) {
    id
    title
    comments {
      id
      content
    }
  }
}
```

This generates:
- 1 query to fetch 10 posts
- 10 separate queries to fetch comments for each post
- **Total: 11 queries**

### With DataLoader
The same query generates:
- 1 query to fetch 10 posts
- 1 batched query to fetch all comments for all posts
- **Total: 2 queries**

## Usage

### 1. Enable DataLoader in Schema Generation

```typescript
import { buildSchemaSDL } from 'drizzle-graphql-plus/build-schema-sdl-with-dl';
import { createDataLoaderContext } from 'drizzle-graphql-plus/build-schema-sdl-with-dl/utils';

const { typeDefs, resolvers } = buildSchemaSDL(db, {
  useDataLoader: true  // Enable DataLoader (default: true)
});
```

### 2. Setup Context in Your GraphQL Server

#### With GraphQL Yoga

**Option 1: Using the Comprehensive Envelop Plugin with Database Injection (Recommended)**
```typescript
import { createYoga, useEnvelop } from 'graphql-yoga';
import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute, subscribe } from 'graphql';
import { 
  buildSchemaSDLWithDataLoader, 
  useDataLoaderCleanup // Available from main package!
} from 'drizzle-graphql-plus';

const { typeDefs, resolvers } = buildSchemaSDLWithDataLoader(db);
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create Envelop instance with comprehensive DataLoader plugin
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe }),
    useSchema(schema),
    useDataLoaderCleanup({ db }), // Automatically injects db AND creates/cleans DataLoaders
  ],
});

const yoga = createYoga({
  plugins: [useEnvelop(getEnveloped)],
  context: async ({ request }) => {
    // DataLoader context AND database are automatically injected!
    return {
      request,
      // db and relationLoaders are added automatically by the plugin
    };
  },
});
```

**Option 2: Using the Plugin Without Database Injection**
```typescript
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe }),
    useSchema(schema),
    useDataLoaderCleanup(), // Only handles DataLoader context creation and cleanup
  ],
});

const yoga = createYoga({
  plugins: [useEnvelop(getEnveloped)],
  context: async ({ request }) => {
    return {
      request,
      db, // You still need to add db manually
      // relationLoaders are added automatically
    };
  },
});
```

**Option 3: Using Separate Plugins for Granular Control**
```typescript
import { 
  useDataLoaderContext,    // Creates context and optionally injects db
  useDataLoaderCleanupOnly // Only handles cleanup
} from 'drizzle-graphql-plus'; // Available from main package!

const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe }),
    useSchema(schema),
    useDataLoaderContext({ db }),    // Create DataLoader context and inject db
    useDataLoaderCleanupOnly(),      // Handle cleanup
  ],
});
```

**Option 4: Using Inline Plugin**
```typescript
import { createYoga } from 'graphql-yoga';
import { createDataLoaderContext, cleanupDataLoaderContext } from 'drizzle-graphql-plus/build-schema-sdl-with-dl/utils';

const yoga = createYoga({
  typeDefs,
  resolvers,
  context: async () => {
    const dataLoaderContext = createDataLoaderContext();
    return {
      ...dataLoaderContext,
      // Your other context properties
    };
  },
  plugins: [
    {
      onExecute: ({ args }) => ({
        onExecuteDone: ({ result }) => {
          // Cleanup after each request
          if (args.contextValue?.relationLoaders) {
            cleanupDataLoaderContext(args.contextValue);
          }
        }
      })
    }
  ]
});
```

#### With Apollo Server
```typescript
import { ApolloServer } from '@apollo/server';
import { createDataLoaderContext, cleanupDataLoaderContext } from 'drizzle-graphql-plus/dataloader';

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    {
      requestDidStart() {
        return {
          willSendResponse(requestContext) {
            // Cleanup DataLoaders
            if (requestContext.context?.relationLoaders) {
              cleanupDataLoaderContext(requestContext.context);
            }
          }
        };
      }
    }
  ]
});
```

### 3. Context Interface

Your GraphQL context should include the DataLoader context:

```typescript
interface GraphQLContext extends DataLoaderContext {
  // Your existing context properties
  user?: User;
  db: DrizzleDB;
  // DataLoader context (automatically included)
  relationLoaders: Map<string, RelationDataLoader>;
}
```

## How It Works

### 1. Relation Detection
When a GraphQL query includes relations, the DataLoader resolver:
- Fetches main entities first (without relations)
- Identifies which relations are requested
- Extracts parent IDs for batching

### 2. Batching Strategy
For each relation type with the same query parameters:
- Collects all parent IDs from the current request batch
- Executes a single query with `WHERE foreign_key IN (parent_ids)`
- Groups results by parent ID

### 3. Nested Relations
Nested relations are handled recursively:
- After loading first-level relations, the system identifies nested relation requests
- Applies the same batching strategy to nested levels
- Maintains the full relation tree structure

## Query Clauses Support

DataLoader maintains full support for Drizzle query clauses:

```graphql
query ComplexQuery {
  postFindMany {
    id
    title
    comments(
      where: { published: true }
      orderBy: { createdAt: { direction: "desc", priority: 1 } }
      limit: 5
      offset: 0
    ) {
      id
      content
      author(where: { active: true }) {
        id
        name
      }
    }
  }
}
```

Each relation can have its own:
- `where` clauses
- `orderBy` specifications  
- `limit` and `offset` pagination
- Nested relation parameters

## Performance Benefits

### Benchmark Example
For a query fetching 100 posts with comments and authors:

| Method | Queries | Time |
|--------|---------|------|
| Without DataLoader | 301 queries | ~2000ms |
| With DataLoader | 4 queries | ~50ms |

### Memory Usage
DataLoader caches results per request, which:
- ✅ Eliminates duplicate fetches
- ✅ Reduces database load
- ✅ Automatically clears after each request
- ⚠️ Uses more memory during request processing

## Configuration Options

### Resolver Configuration
```typescript
const { schema } = buildSchemaSDL(db, {
  resolverConfig: {
    useDataLoader: true,
    // Optional: Configure DataLoader behavior
    dataLoaderOptions: {
      maxBatchSize: 1000,  // Maximum items per batch
      cache: true,         // Enable caching (default: true)
    }
  }
});
```

### Per-Query Optimization
You can mix DataLoader and traditional resolvers:
```typescript
// Some resolvers use DataLoader
const postResolver = createDataLoaderFindManyResolver(/*...*/);

// Others use traditional approach for simple cases
const userResolver = createFindManyResolver(/*...*/);
```

## Best Practices

### 1. Always Cleanup
```typescript
// Always cleanup DataLoaders after each request
plugins: [
  {
    onExecute: ({ args }) => ({
      onExecuteDone: ({ result }) => {
        cleanupDataLoaderContext(args.contextValue);
      }
    })
  }
]
```

### 2. Monitor Performance
```typescript
// Add logging to monitor batching effectiveness
const dataLoaderContext = createDataLoaderContext();
dataLoaderContext.onBatch = (batchSize, relationName) => {
  console.log(`Batched ${batchSize} ${relationName} queries`);
};
```

### 3. Handle Errors Gracefully
DataLoader automatically handles:
- Missing relations
- Invalid foreign keys
- Database connection errors

### 4. Consider Memory Usage
For very large datasets:
- Set appropriate `maxBatchSize`
- Monitor memory usage during peak loads
- Consider disabling cache for memory-sensitive operations

## Migration Guide

### From Traditional Resolvers
1. Update schema generation to enable DataLoader
2. Add DataLoader context to your GraphQL server
3. Ensure proper cleanup after requests
4. Test performance improvements

### Gradual Migration
You can migrate incrementally:
```typescript
// Enable DataLoader for specific tables
const resolverConfig = {
  useDataLoader: {
    posts: true,      // Use DataLoader for posts
    comments: true,   // Use DataLoader for comments  
    users: false,     // Keep traditional resolver for users
  }
};
```

## Troubleshooting

### Common Issues

1. **Context Not Available**
   ```
   Error: DataLoader context not found
   ```
   Solution: Ensure `createDataLoaderContext()` is called in your GraphQL context

2. **Memory Leaks**
   ```
   Warning: DataLoader cache growing indefinitely
   ```
   Solution: Verify cleanup is called after each request

3. **Performance Regression**
   ```
   Queries slower with DataLoader enabled
   ```
   Solution: Check if batching is actually occurring; may need to adjust batch size

### Debug Mode
Enable debug logging:
```typescript
const context = createDataLoaderContext();
context.debug = true; // Logs all DataLoader operations
```

## Advanced Usage

### Custom DataLoader Configuration
```typescript
import DataLoader from 'dataloader';

// Custom DataLoader with specific options
const customLoader = new DataLoader(batchFn, {
  maxBatchSize: 100,
  cache: false,
  batchScheduleFn: callback => setTimeout(callback, 10)
});
```

### Integration with Other Tools
DataLoader works well with:
- GraphQL query complexity analysis
- APM tools (New Relic, DataDog)
- Database connection pooling
- Redis caching layers
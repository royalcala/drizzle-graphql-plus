# Build Schema SDL with DataLoader

This directory contains a DataLoader-optimized version of `buildSchemaSDL` that eliminates N+1 query problems and dramatically improves performance for relational queries.

## Key Features

- **DataLoader Always Enabled**: Built-in DataLoader support with no configuration needed
- **Zero Configuration**: Simple API - just pass your database instance
- **Performance Optimized**: Eliminates N+1 queries by batching relation queries
- **Clean Separation**: Focused solely on DataLoader approach (legacy patterns in separate folder)

## Usage

```typescript
import { buildSchemaSDL } from './build-schema-sdl-with-dl';
import { createDataLoaderContext, cleanupDataLoaderContext } from './build-schema-sdl-with-dl/generator/utils/context';

// Generate schema with DataLoader (always enabled)
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Setup GraphQL server with DataLoader context
const yoga = createYoga({
  typeDefs,
  resolvers,
  context: async () => {
    return {
      db, // Required for DataLoader resolvers
      ...createDataLoaderContext()
    };
  },
  plugins: [
    {
      onRequestResult: ({ result }) => {
        cleanupDataLoaderContext(result.context);
      }
    }
  ]
});
```

## Performance Benefits

### Without DataLoader (Legacy)
```
Query: 100 posts with comments and authors
- 1 query for posts
- 100 queries for comments (one per post)  
- N queries for comment authors
- 100 queries for post authors
Total: 201+ queries
```

### With DataLoader (This Version)
```
Query: 100 posts with comments and authors
- 1 query for posts
- 1 batched query for all comments
- 1 batched query for all comment authors  
- 1 batched query for all post authors
Total: 4 queries
```

## Directory Structure

```
src/build-schema-sdl-with-dl/
├── index.ts                    # Main entry point (simplified API)
├── generator/
│   ├── types.ts               # Type definitions (no config types)
│   ├── schema/                # Schema generation
│   │   ├── generation.ts      # Table and relation analysis
│   │   ├── type-defs.ts       # GraphQL type definitions
│   │   └── index.ts
│   ├── queries/               # Query resolvers
│   │   ├── dataloader-resolvers.ts  # DataLoader resolvers (only)
│   │   └── index.ts
│   ├── mutations/             # Mutation resolvers
│   │   ├── resolvers.ts       # Mutation implementations
│   │   └── index.ts
│   └── utils/                 # Utilities
│       ├── dataloader.ts      # DataLoader implementation
│       ├── context.ts         # Context management
│       ├── filters.ts         # Where clause building
│       └── selection.ts       # Field selection
└── README.md                  # This file
```

## API Comparison

### Legacy buildSchemaSDL (with options)
```typescript
// Located in src/buildSchemaSDL/
const { typeDefs, resolvers } = buildSchemaSDL(db, {
  useDataLoader: true,
  relationsDepthLimit: 5,
  // ... other options
});
```

### DataLoader-Only buildSchemaSDL (this version)
```typescript
// Located in src/build-schema-sdl-with-dl/
const { typeDefs, resolvers } = buildSchemaSDL(db); // No options needed!
```

## Migration from Legacy buildSchemaSDL

1. Change import path:
   ```typescript
   // Before
   import { buildSchemaSDL } from './buildSchemaSDL';
   
   // After  
   import { buildSchemaSDL } from './build-schema-sdl-with-dl';
   ```

2. Remove configuration options:
   ```typescript
   // Before
   const { typeDefs, resolvers } = buildSchemaSDL(db, {
     useDataLoader: true,
     relationsDepthLimit: 5
   });
   
   // After
   const { typeDefs, resolvers } = buildSchemaSDL(db);
   ```

3. Add DataLoader context to your GraphQL server (see usage example above)

4. Enjoy improved performance with cleaner code!

## See Also

- [DataLoader Documentation](../../docs/DATALOADER.md) - Comprehensive guide
- [Usage Examples](../../examples/dataloader-usage.ts) - Complete examples
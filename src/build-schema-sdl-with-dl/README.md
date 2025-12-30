# Drizzle GraphQL SDL with DataLoader

A composable GraphQL schema generator for Drizzle ORM with built-in DataLoader optimization and directive support.

## Features

- 🚀 **DataLoader optimization** - Automatic batching and caching for relations
- 🎯 **Self-referencing relations** - Support for comment replies, nested categories, etc.
- 🔧 **Composable architecture** - Mix and match features as needed
- 📝 **GraphQL directives** - `@populateFromParent` for query optimization
- 🎨 **Custom scalars** - Built-in JSON scalar and easy custom scalar support
- 🔒 **Type safety** - Full TypeScript support with inferred types

## Basic Usage

### Explicit Control Approach (Recommended)

```typescript
import { 
  buildSchemaSDL, 
  populateFromParentDirectiveTypeDefs,
  exportDirectiveTypeDefs,
  commonScalars,
  makeExecutableSchema,
  applyDirectiveTransformers
} from "./index";
import { drizzle } from "drizzle-orm/libsql";

const db = drizzle(client, { schema });

// 1. Generate basic schema
const { typeDefs, resolvers } = buildSchemaSDL(db);

// 2. Create executable schema with explicit typeDefs array
const executableSchema = makeExecutableSchema({
  typeDefs: [
    populateFromParentDirectiveTypeDefs,  // @populateFromParent directive
    exportDirectiveTypeDefs,              // @export directive
    `enum Status { ACTIVE INACTIVE }`,    // Your custom types
    typeDefs                              // Generated schema
  ],
  resolvers: {
    ...resolvers,
    ...commonScalars,
    // Your custom scalars/resolvers
  },
});

// 3. Apply directive transformers
const schema = applyDirectiveTransformers(executableSchema, {
  includePopulateFromParent: true,
});

// 4. Use with any GraphQL server
const server = new ApolloServer({ schema });
```

This gives you full control over what gets included and in what order!

### Manual Composable Approach (Advanced)

If you need even more control, you can build everything step by step:

```typescript
import { 
  buildSchemaSDL, 
  populateFromParentDirectiveTypeDefs,
  exportDirectiveTypeDefs,
  commonScalars,
  makeExecutableSchema,
  populateFromParentDirectiveTransformer
} from "./index";

// 1. Generate basic typeDefs and resolvers
const { typeDefs, resolvers } = buildSchemaSDL(db);

// 2. Build your typeDefs array exactly how you want
const allTypeDefs = [
  populateFromParentDirectiveTypeDefs,
  exportDirectiveTypeDefs,
  `scalar DateTime`,
  `enum Status { ACTIVE INACTIVE }`,
  typeDefs
];

// 3. Create executable schema
const executableSchema = makeExecutableSchema({
  typeDefs: allTypeDefs,
  resolvers: { 
    ...resolvers, 
    ...commonScalars,
    DateTime: myDateTimeScalar 
  },
});

// 4. Apply only the transformers you want
const schema = populateFromParentDirectiveTransformer(executableSchema);
```

## Composable Architecture

### 1. Basic Schema Generation

```typescript
const { typeDefs, resolvers } = buildSchemaSDL(db);
```

### 2. Add Custom Types and Scalars

```typescript
import { commonScalars } from "./index";

const customTypes = `
  enum Status { ACTIVE INACTIVE }
  scalar DateTime
`;

const extendedTypeDefs = customTypes + "\n" + typeDefs;
const extendedResolvers = {
  ...resolvers,
  ...commonScalars, // Includes JSON scalar
  DateTime: myDateTimeScalar,
  Status: myStatusResolver,
};
```

### 3. Add Directive Definitions

```typescript
import { addDirectiveDefinitions } from "./index";

const typeDefsWithDirectives = addDirectiveDefinitions(extendedTypeDefs);
```

### 4. Apply Directive Transformers

```typescript
import { applyDirectiveTransformers } from "./index";
import { makeExecutableSchema } from "@graphql-tools/schema";

// Create basic executable schema
const executableSchema = makeExecutableSchema({
  typeDefs: typeDefsWithDirectives,
  resolvers: extendedResolvers,
});

// Apply directive transformers
const schemaWithDirectives = applyDirectiveTransformers(executableSchema, {
  includePopulateFromParent: true
});
```

## Available Exports

### Core Functions

- `buildSchemaSDL(db)` - Generate basic typeDefs and resolvers
- `makeExecutableSchema` - Re-exported from @graphql-tools/schema for convenience
- `applyDirectiveTransformers(schema, options)` - Apply directive transformers to executable schema

### Directive TypeDefs

- `populateFromParentDirectiveTypeDefs` - TypeDefs for @populateFromParent directive
- `exportDirectiveTypeDefs` - TypeDefs for @export directive

### Utilities

- `commonScalars` - Pre-built scalars (JSON, etc.)
- `populateFromParentDirectiveTransformer` - Individual transformer function

## GraphQL Directives

### @populateFromParent

Optimizes nested queries by reusing parent data when possible:

```graphql
query {
  posts {
    id
    title
    comments {
      id
      text
      # Uses parent data instead of fresh DB query
      replies @populateFromParent(source: "comments") {
        id
        text
      }
    }
  }
}
```

### @export

Enables cross-field dependencies by allowing one field to export a value that another field can consume:

```graphql
query {
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "userId")
    name
  }
  posts: postFindMany(where: { userId: { eq: $_userId } }) {
    title
  }
}
```

Both directives automatically fall back to fresh DB queries when complex filtering is needed.

## DataLoader Features

- **Automatic batching** - Multiple relation queries are batched together
- **Caching** - Results are cached within the same request
- **N+1 prevention** - Eliminates N+1 query problems
- **Self-referencing relations** - Handles comment replies, nested categories, etc.

## Performance Analysis

The DataLoader implementation provides significant performance improvements:

```
Without DataLoader: 1 + N queries (N+1 problem)
With DataLoader: 2-4 optimized queries (batched)
```

For complex nested relations like posts → comments → replies:
- **Traditional**: 1 + N + M queries
- **With DataLoader**: 4 queries (posts, comments, replies, parent comments)
- **With @populateFromParent**: 2 queries (posts, comments - replies populated from parent)

## Integration Examples

### Apollo Server

```typescript
import { ApolloServer } from '@apollo/server';
import { 
  buildSchemaSDL, 
  populateFromParentDirectiveTypeDefs,
  exportDirectiveTypeDefs,
  commonScalars,
  makeExecutableSchema,
  applyDirectiveTransformers
} from './index';

const { typeDefs, resolvers } = buildSchemaSDL(db);

const schema = applyDirectiveTransformers(
  makeExecutableSchema({
    typeDefs: [
      populateFromParentDirectiveTypeDefs,
      exportDirectiveTypeDefs,
      typeDefs
    ],
    resolvers: { ...resolvers, ...commonScalars },
  }),
  { includePopulateFromParent: true }
);

const server = new ApolloServer({ schema });
```

### GraphQL Yoga

```typescript
import { createYoga } from 'graphql-yoga';
import { 
  buildSchemaSDL, 
  populateFromParentDirectiveTypeDefs,
  exportDirectiveTypeDefs,
  commonScalars,
  makeExecutableSchema,
  applyDirectiveTransformers
} from './index';

const { typeDefs, resolvers } = buildSchemaSDL(db);

const schema = applyDirectiveTransformers(
  makeExecutableSchema({
    typeDefs: [
      populateFromParentDirectiveTypeDefs,
      exportDirectiveTypeDefs,
      typeDefs
    ],
    resolvers: { ...resolvers, ...commonScalars },
  }),
  { includePopulateFromParent: true }
);

const yoga = createYoga({ schema });
```

## Why Separated Architecture?

The new composable approach provides several benefits:

1. **Flexibility** - Use only what you need
2. **Testability** - Each component can be tested independently  
3. **Customization** - Easy to add custom types, scalars, and directives
4. **Server agnostic** - Works with any GraphQL server
5. **Progressive enhancement** - Start basic, add features as needed

## Migration from Complex Multi-Step Approach

**Before (Complex Multi-Step):**
```typescript
const { typeDefs, resolvers } = buildSchemaSDL(db);
const typeDefsWithDirectives = addDirectiveDefinitions(typeDefs);
const executableSchema = makeExecutableSchema({
  typeDefs: typeDefsWithDirectives,
  resolvers: { ...resolvers, ...commonScalars },
});
const schemaWithDirectives = applyDirectiveTransformers(executableSchema, {
  includePopulateFromParent: true
});
```

**After (Explicit Control):**
```typescript
const { typeDefs, resolvers } = buildSchemaSDL(db);

const schema = applyDirectiveTransformers(
  makeExecutableSchema({
    typeDefs: [
      populateFromParentDirectiveTypeDefs,
      exportDirectiveTypeDefs,
      typeDefs
    ],
    resolvers: { ...resolvers, ...commonScalars },
  }),
  { includePopulateFromParent: true }
);
```

This gives you full transparency and control over what gets included in your schema, while still providing all the powerful features with minimal code.
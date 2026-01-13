# Serial Envelop Hooks

A clean, simple implementation of the `@serial` directive using Envelop plugins. This forces GraphQL query fields to execute sequentially instead of in parallel.

## Overview

By default, GraphQL executes root-level fields in parallel for better performance. However, there are scenarios where you need sequential execution:

- **Debugging**: Understanding the exact order of operations
- **Performance**: Avoiding database connection pool exhaustion
- **Business Logic**: Ensuring operations happen in a specific order
- **Rate Limiting**: Preventing concurrent requests to external APIs

This module provides an Envelop plugin that detects the `@serial` directive on queries and ensures root-level fields execute one after another.

## Installation

This module is included in `drizzle-graphql-plus`. No additional installation needed.

## Usage

### 1. Add the directive to your schema

```typescript
import { serialDirectiveTypeDefs } from 'drizzle-graphql-plus/serial-envelop-hooks';

const typeDefs = `
  ${serialDirectiveTypeDefs}
  
  type Query {
    users: [User!]!
    posts: [Post!]!
    comments: [Comment!]!
  }
`;
```

### 2. Add the plugin to your Envelop setup

```typescript
import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute, subscribe, parse } from 'graphql';
import { useSerialDirective } from 'drizzle-graphql-plus/serial-envelop-hooks';

const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe, parse }),
    useSchema(schema),
    useSerialDirective(), // Add this plugin
  ],
});
```

### 3. Use the directive in your queries

```graphql
# Fields execute sequentially: users → posts → comments
query GetDataSequentially @serial {
  users {
    id
    name
  }
  posts {
    id
    title
  }
  comments {
    id
    text
  }
}

# Without @serial, fields execute in parallel (default behavior)
query GetDataInParallel {
  users { id, name }
  posts { id, title }
  comments { id, text }
}
```

## How It Works

1. **Detection**: The plugin checks if a query has the `@serial` directive
2. **Interception**: If detected, it intercepts the resolver execution
3. **Queueing**: Root-level fields are queued to execute sequentially
4. **Nested Fields**: Fields nested within each root field still execute in parallel (within their parent scope)

### Execution Flow

```
Without @serial (parallel):
├─ users ──┐
├─ posts ──┼─→ All execute simultaneously
└─ comments┘

With @serial (sequential):
├─ users ────→ waits to complete
├─ posts ────→ waits to complete  
└─ comments ─→ waits to complete
```

## Debugging

Enable debug logging to see execution order:

```bash
DEBUG_SERIAL=true node your-server.js
```

This will log:
- When serial execution is enabled
- Which fields are being queued
- When each field starts and completes execution

## Performance Considerations

### When to Use @serial

✅ **Good use cases:**
- Debugging execution order
- Avoiding database connection pool exhaustion
- Rate-limited external API calls
- Operations that must happen in a specific order

❌ **Avoid using @serial when:**
- Fields are independent and can run in parallel
- Performance is critical and parallel execution is faster
- You have sufficient database connections

### Performance Impact

Serial execution will generally be slower than parallel execution because operations wait for each other to complete. However, in some scenarios (like connection pool limits), serial execution can actually improve overall throughput.

## Comparison with Resolver Composition Approach

This module provides a cleaner alternative to the `serial-directive` module:

| Feature | serial-envelop-hooks (this) | serial-directive |
|---------|---------------------------|------------------|
| **Integration** | Envelop plugin | Resolver composition |
| **Setup Complexity** | Low (just add plugin) | Medium (compose resolvers) |
| **Code Lines** | ~200 | ~400 |
| **Dependencies** | @envelop/core | @graphql-tools/resolvers-composition |
| **Execution Control** | Root-level fields only | Configurable per-parent |

## API Reference

### `useSerialDirective()`

Envelop plugin that enables `@serial` directive support.

```typescript
const getEnveloped = envelop({
  plugins: [
    useSerialDirective(),
  ],
});
```

### `serialDirectiveTypeDefs`

GraphQL type definition string for the `@serial` directive.

```typescript
const typeDefs = `
  ${serialDirectiveTypeDefs}
  
  type Query {
    # your fields
  }
`;
```

### `addSerialDirective(typeDefs: string): string`

Helper function to add the directive to existing type definitions.

```typescript
const typeDefsWithSerial = addSerialDirective(myTypeDefs);
```

### `hasSerialDirective(document: DocumentNode, operationName?: string): boolean`

Check if a GraphQL document has the `@serial` directive.

```typescript
import { parse } from 'graphql';
import { hasSerialDirective } from 'drizzle-graphql-plus/serial-envelop-hooks';

const doc = parse('query Test @serial { users { id } }');
const isSerial = hasSerialDirective(doc); // true
```

## Examples

### With drizzle-graphql schema builder

```typescript
import { buildSchemaSDL } from 'drizzle-graphql-plus';
import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute, subscribe, parse } from 'graphql';
import { useSerialDirective, serialDirectiveTypeDefs } from 'drizzle-graphql-plus/serial-envelop-hooks';
import { makeExecutableSchema } from '@graphql-tools/schema';

// Build schema from Drizzle
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add serial directive to type definitions
const fullTypeDefs = [serialDirectiveTypeDefs, typeDefs].join('\\n\\n');

// Create executable schema
const schema = makeExecutableSchema({
  typeDefs: fullTypeDefs,
  resolvers,
});

// Create Envelop instance with serial directive support
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe, parse }),
    useSchema(schema),
    useSerialDirective(),
  ],
});
```

### With GraphQL Yoga

```typescript
import { createYoga } from 'graphql-yoga';
import { useSerialDirective, serialDirectiveTypeDefs } from 'drizzle-graphql-plus/serial-envelop-hooks';

const yoga = createYoga({
  schema,
  plugins: [
    useSerialDirective(),
  ],
});
```

## License

Apache-2.0

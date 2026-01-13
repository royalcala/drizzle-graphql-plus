# Export Directive Envelop Hooks

A clean, simple implementation of the `@export` directive using Envelop plugins. This enables cross-field dependencies in GraphQL queries.

## Overview

The `@export` directive allows fields to export their values for use by other fields in the same query. This is useful for:

- **Cross-field dependencies**: Use data from one field as input to another
- **Dynamic queries**: Build queries where later fields depend on earlier results
- **Data aggregation**: Collect values from multiple fields into arrays
- **Avoiding multiple round trips**: Fetch related data in a single query

## Installation

This module is included in `drizzle-graphql-plus`. No additional installation needed.

## Usage

### 1. Add the directive to your schema

```typescript
import { exportDirectiveTypeDefs } from "drizzle-graphql-plus/export-directive-envelop-hooks";

const typeDefs = `
  ${exportDirectiveTypeDefs}
  
  type Query {
    userFindFirst(where: UserWhereInput): User
    postFindMany(where: PostWhereInput): [Post!]!
  }
`;
```

### 2. Add the plugin to your Envelop setup

```typescript
import { envelop, useEngine, useSchema } from "@envelop/core";
import { execute, subscribe, parse } from "graphql";
import { useExportDirective } from "drizzle-graphql-plus/export-directive-envelop-hooks";

const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe, parse }),
    useSchema(schema),
    useExportDirective(), // Add this plugin
  ],
});
```

### 3. Use the directive in your queries

```graphql
query ($_userId: ID = "") {
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "$_userId")
    name
  }
  posts: postFindMany(where: { userId: { eq: $_userId } }) {
    title
  }
}
```

## How It Works

1. **Variable Declaration**: Declare GraphQL variables with default empty values
2. **Export**: Use `@export(as: "$_variableName")` to export field values
3. **Import**: Reference the variable in other fields (e.g., `eq: $_userId`)
4. **Resolution**: The plugin resolves export variables before executing each field

### Execution Flow

```
1. Execute user field
   ├─ Resolve arguments (no exports yet)
   ├─ Fetch user data
   └─ Store id value as "$_userId" export

2. Execute posts field
   ├─ Detect $_userId in arguments
   ├─ Resolve $_userId from export store
   ├─ Fetch posts with resolved userId
   └─ Return results
```

## Features

### Single Value Export

Export a single value from one field to another:

```graphql
query ($_cityId: ID = "") {
  city: cityFindFirst(where: { name: { eq: "New York" } }) {
    id @export(as: "$_cityId")
    name
  }
  posts: postFindMany(where: { cityId: { eq: $_cityId } }) {
    title
  }
}
```

### Array Accumulation

Export values from array items - they automatically accumulate:

```graphql
query ($_authorIds: [ID!] = [""]) {
  users: userFindMany(limit: 5) {
    id @export(as: "$_authorIds")
    name
  }
  posts: postFindMany(where: { authorId: { in: $_authorIds } }) {
    title
  }
}
```

The plugin automatically:

- Collects all `id` values from the users array
- Deduplicates them
- Makes them available as `$_authorIds` for the posts query

### Nested Exports

Export values from nested fields:

```graphql
query ($_postIds: [ID!] = [""]) {
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    name
    posts {
      id @export(as: "$_postIds")
      title
    }
  }
  comments: commentFindMany(where: { postId: { in: $_postIds } }) {
    text
  }
}
```

## Best Practices

### Use with @serial Directive

For predictable execution order and reliable accumulation, combine with `@serial`:

```graphql
query ($_userIds: [ID!] = [""]) @serial {
  users: userFindMany(limit: 10) {
    id @export(as: "$_userIds")
    name
  }
  posts: postFindMany(where: { authorId: { in: $_userIds } }) {
    title
  }
}
```

> [!IMPORTANT]
> Without `@serial`, fields execute in parallel, which can cause race conditions with exports. Use `@serial` when:
>
> - Exporting from array items (accumulation)
> - One field depends on another's export
> - Order of execution matters

### Variable Naming Convention

- **GraphQL variable**: `$_variableName` (with underscore prefix)
- **Export directive**: `@export(as: "$_variableName")` (same name)
- **Always declare**: `query ($_variableName: Type = defaultValue)`

### Filter Operator Compatibility

The generated SDL and resolvers use `inArray`/`notInArray` as filter
operators (for example `postId: { inArray: [...] }`). For convenience,
the export directive plugin also accepts GraphQL-style `in` in filters
and normalizes it to `inArray` before calling the underlying resolvers.

This means queries like these are both supported:

```graphql
posts: postFindMany(where: { authorId: { in: $_authorIds } }) { ... }

posts: postFindMany(where: { authorId: { inArray: $_authorIds } }) { ... }
```

Internally, both are mapped to the same Drizzle `inArray` condition,
which Drizzle converts into SQL `IN (...)` clauses.

## Debugging

Enable debug logging to see export operations:

```bash
DEBUG_EXPORT=true node your-server.js
```

This will log:

- When export store is created
- When export variables are resolved
- When values are exported
- Current state of the export store

## API Reference

### `useExportDirective()`

Envelop plugin that enables `@export` directive support.

```typescript
const getEnveloped = envelop({
  plugins: [useExportDirective()],
});
```

### `exportDirectiveTypeDefs`

GraphQL type definition string for the `@export` directive.

```typescript
const typeDefs = `
  ${exportDirectiveTypeDefs}
  
  type Query {
    # your fields
  }
`;
```

### `addExportDirective(typeDefs: string): string`

Helper function to add the directive to existing type definitions.

```typescript
const typeDefsWithExport = addExportDirective(myTypeDefs);
```

### `ExportStore`

Store class for managing exported values:

- `set(name, value)` - Store a value
- `accumulate(name, value)` - Accumulate values into an array
- `get(name)` - Get a value
- `waitFor(name, timeout)` - Wait for a value (Promise-based)
- `has(name)` - Check if value exists
- `clear()` - Clear all values

## Examples

### With drizzle-graphql schema builder

```typescript
import { buildSchemaSDL } from "drizzle-graphql-plus";
import { envelop, useEngine, useSchema } from "@envelop/core";
import { execute, subscribe, parse } from "graphql";
import {
  useExportDirective,
  exportDirectiveTypeDefs,
} from "drizzle-graphql-plus/export-directive-envelop-hooks";
import { makeExecutableSchema } from "@graphql-tools/schema";

// Build schema from Drizzle
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add export directive to type definitions
const fullTypeDefs = [exportDirectiveTypeDefs, typeDefs].join("\\n\\n");

// Create executable schema
const schema = makeExecutableSchema({
  typeDefs: fullTypeDefs,
  resolvers,
});

// Create Envelop instance with export directive support
const getEnveloped = envelop({
  plugins: [
    useEngine({ execute, subscribe, parse }),
    useSchema(schema),
    useExportDirective(),
  ],
});
```

### With GraphQL Yoga

```typescript
import { createYoga } from "graphql-yoga";
import { useExportDirective } from "drizzle-graphql-plus/export-directive-envelop-hooks";

const yoga = createYoga({
  schema,
  plugins: [useExportDirective()],
});
```

### Complex Example

```graphql
query ($_userId: ID = "", $_postIds: [ID!] = [""], $_commentIds: [ID!] = [""])
@serial {
  # Step 1: Find user
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "$_userId")
    name
  }

  # Step 2: Get user's posts
  posts: postFindMany(where: { authorId: { eq: $_userId } }) {
    id @export(as: "$_postIds")
    title
  }

  # Step 3: Get comments on those posts
  comments: commentFindMany(where: { postId: { in: $_postIds } }) {
    id @export(as: "$_commentIds")
    text
  }

  # Step 4: Get reactions to those comments
  reactions: reactionFindMany(where: { commentId: { in: $_commentIds } }) {
    type
    user {
      name
    }
  }
}
```

## Comparison with Resolver Composition Approach

| Feature                      | export-directive-envelop-hooks (this) | export-directive                     |
| ---------------------------- | ------------------------------------- | ------------------------------------ |
| **Integration**              | Envelop plugin                        | Resolver composition                 |
| **Setup Complexity**         | Low (just add plugin)                 | Medium (compose resolvers)           |
| **Code Lines**               | ~400                                  | ~600                                 |
| **Dependencies**             | @envelop/core                         | @graphql-tools/resolvers-composition |
| **GraphQL Variable Updates** | Automatic                             | Manual tracking                      |

## License

Apache-2.0

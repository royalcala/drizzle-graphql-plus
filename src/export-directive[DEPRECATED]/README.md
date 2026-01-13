# Export Tool - @export Directive with Flexible Scalar

This directory contains the implementation of the `@export` directive for drizzle-graphql, enabling cross-field dependencies in GraphQL queries.

## ✅ Working Solution: Flexible Scalar + GraphQL Variables + Nested Relations

The `@export` directive works using:

1.  **Flexible Scalars** - Wrap ANY scalar (ULID, Int, etc.) to accept `$_pattern` strings
2.  **GraphQL variables** - Use variables with default values to pass `$_` patterns
3.  **Resolver composition** - Middleware resolves patterns at execution time
4.  **Nested relation support** - Export variables work in nested relation queries (NEW!)

### Nested Relations Example (NEW!)

The export directive now works seamlessly with nested relations:

```graphql
query GetSportPostsByCity(
  $citySlug: String!
  $sportName: String!
  $_cityId: ID = ""
) {
  cityFindFirst(where: { slug: { eq: $citySlug } }) {
    id @export(as: "$_cityId") # ← Must match GraphQL variable name
    name
    slug
  }
  sportWithPosts: sportFindFirst(where: { name: { eq: $sportName } }) {
    id
    name
    posts(where: { cityId: { eq: $_cityId } }) {
      id
      title
      content
      cityId
      sportId
    }
  }
}
```

Call with:

```javascript
graphql({
  schema,
  source: query,
  variableValues: {
    citySlug: "new-york",
    sportName: "Football",
    _cityId: "", // Empty default, will be filled by export
  },
  contextValue: {},
});
```

This will:

1. Find the city by slug and export its ID as "cityId"
2. Find the sport by name
3. Filter the sport's posts to only include those from the exported city ID

### Basic Usage Example

```typescript
import {
  makeFlexibleScalar,
  createExportResolverMap,
} from "drizzle-graphql/export-tool";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { GraphQLULID } from "graphql-scalars"; // or your own scalar

// 1. Create a "flexible" version of your scalar
const FlexibleULID = makeFlexibleScalar(GraphQLULID);

const resolvers = {
  ...yourResolvers,
  // 2. Override the standard scalar with the flexible one
  ULID: FlexibleULID,
};

// 3. Apply export middleware
const composedResolvers = composeResolvers(
  resolvers,
  createExportResolverMap()
);
```

## 🔧 Resolver Setup Requirements

To enable export variables in your GraphQL schema, you need to configure three key components:

### 1. **Schema Setup - Add the @export Directive**

Add the `@export` directive to your GraphQL schema:

```typescript
import { buildSchemaSDL } from "drizzle-graphql";

const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add the @export directive to your schema
const extendedTypeDefs = `
  directive @export(as: String!) on FIELD
  ${typeDefs}
`;
```

### 2. **Scalar Setup - Use Flexible Scalars**

Replace standard scalars with flexible versions that accept `$_` patterns:

```typescript
import { makeScalarAcceptExports } from "drizzle-graphql/export-tool";
import { GraphQLULID, GraphQLInt, GraphQLString } from "graphql-scalars";

// Create flexible versions of your scalars
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);
const FlexibleInt = makeScalarAcceptExports(GraphQLInt);
const FlexibleString = makeScalarAcceptExports(GraphQLString);

const resolverMap = {
  ...resolvers,
  // Override scalars with flexible versions
  ID: FlexibleULID, // For ULID/ID fields
  ULID: FlexibleULID, // If you use ULID scalar
  Int: FlexibleInt, // For integer fields
  String: FlexibleString, // For string fields (if needed)
};
```

### 3. **Middleware Setup - Apply Export Middleware**

Wrap your resolvers with the export middleware:

```typescript
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { createExportMiddleware } from "drizzle-graphql/export-tool";

// Apply export middleware to ALL resolvers
const composedResolvers = composeResolvers(resolverMap, {
  "*.*": [createExportMiddleware()], // This pattern applies to all resolvers
});
```

### 4. **Complete Setup Example**

Here's a complete setup for a drizzle-graphql project:

```typescript
import { makeExecutableSchema } from "@graphql-tools/schema";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { buildSchemaSDL } from "drizzle-graphql";
import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "drizzle-graphql/export-tool";
import { GraphQLULID } from "graphql-scalars";

// 1. Generate base schema from Drizzle
const { typeDefs, resolvers } = buildSchemaSDL(db);

// 2. Add @export directive to schema
const extendedTypeDefs = `
  directive @export(as: String!) on FIELD
  scalar ULID
  ${typeDefs}
`;

// 3. Create flexible scalars
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);

// 4. Combine resolvers with flexible scalars
const resolverMap = {
  ...resolvers,
  ULID: FlexibleULID, // Allow $_ patterns in ULID fields
  ID: FlexibleULID, // Allow $_ patterns in ID fields
};

// 5. Apply export middleware
const composedResolvers = composeResolvers(resolverMap, {
  "*.*": [createExportMiddleware()],
});

// 6. Create executable schema
const schema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: composedResolvers,
});

export { schema };
```

### 5. **What Each Component Does**

| Component           | Purpose                                | Required For                      |
| ------------------- | -------------------------------------- | --------------------------------- |
| `@export` directive | Marks fields for export                | Storing exported values           |
| Flexible scalars    | Accept `$_` patterns during validation | Using export variables in queries |
| Export middleware   | Resolves `$_` patterns at runtime      | Both storing and using exports    |

### 6. **Automatic Nested Relation Support**

**No additional setup required!** The export middleware automatically handles nested relations when you use `buildSchemaSDL`. The enhanced `extractRelationsParams` function will:

- ✅ Detect export variables in nested relation arguments
- ✅ Resolve them using the same ExportStore
- ✅ Work with any depth of nesting

```typescript
// This works automatically with the setup above:
query($cityId: ID = "") {
  sport: sportFindFirst(where: { name: { eq: "Football" } }) {
    posts(where: { cityId: { eq: $cityId } }) { # ← Automatically resolved!
      id
      title
    }
  }
}
```

## 🔨 Writing Custom Resolvers with Export Support

If you're writing **custom resolvers** (beyond the auto-generated ones from `buildSchemaSDL`), here's what you need to know to make them work with export variables:

### 1. **Export Variables Are Automatically Resolved**

The good news: **You don't need to do anything special!** The export middleware automatically handles export variable resolution for any resolver when you use `composeResolvers`.

```typescript
// Your custom resolver - no special export handling needed!
const customResolvers = {
  Query: {
    myCustomQuery: async (parent, args, context, info) => {
      // args will have export variables already resolved
      // e.g., if query had { userId: { eq: $userId } }
      // args.userId will contain the actual resolved value, not "$_userId"

      console.log("Resolved args:", args);
      return await db.query.myTable.findMany({
        where: eq(myTable.userId, args.userId), // This is the resolved value!
      });
    },
  },
};

// Apply middleware - this makes export variables work automatically
const composedResolvers = composeResolvers(
  {
    ...buildSchemaSDLResolvers,
    ...customResolvers, // Your custom resolvers get export support too!
  },
  {
    "*.*": [createExportMiddleware()],
  }
);
```

### 2. **How Export Resolution Works in Custom Resolvers**

The export middleware wraps your resolver and:

1. **Before your resolver runs**: Checks `args` for `$_varName` patterns and waits for/replaces them with actual values
2. **Your resolver runs**: Gets the resolved values in `args`
3. **After your resolver runs**: Checks the result for `@export` directives and stores exported values

```typescript
// Example: Custom resolver that uses an exported userId
const resolvers = {
  Query: {
    getUserPosts: async (parent, args, context, info) => {
      // args.authorId will be the resolved value (e.g., "01HXXX...")
      // NOT the pattern string "$_userId"

      return await db.query.post.findMany({
        where: eq(post.authorId, args.authorId),
      });
    },
  },
};
```

### 3. **Custom Resolvers That Export Values**

To export values from custom resolvers, you have two options:

#### Option A: Use `@export` Directive (Recommended)

```graphql
query {
  myCustomQuery {
    userId @export(as: "currentUserId")
    name
  }
}
```

The middleware automatically detects the `@export` directive and stores the value.

#### Option B: Manual Export (Advanced)

If you need to export values programmatically:

```typescript
import { ExportStore } from "drizzle-graphql/export-tool";

const resolvers = {
  Query: {
    myCustomQuery: async (parent, args, context, info) => {
      const result = await db.query.user.findFirst({
        where: eq(user.email, args.email),
      });

      // Manual export (only if you can't use @export directive)
      if (context.exportStore && result) {
        (context.exportStore as ExportStore).set("currentUserId", result.id);
      }

      return result;
    },
  },
};
```

### 4. **What You DON'T Need to Do**

❌ **Don't** manually check for `$_` patterns in args  
❌ **Don't** manually resolve export variables  
❌ **Don't** manually access `context.exportStore` (unless advanced use case)  
❌ **Don't** write special export handling logic

✅ **Do** write normal resolvers - middleware handles everything!

### 5. **Example: Complete Custom Resolver Setup**

```typescript
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { createExportMiddleware } from "drizzle-graphql/export-tool";
import { buildSchemaSDL } from "drizzle-graphql";

// 1. Get auto-generated resolvers
const { typeDefs, resolvers: autoResolvers } = buildSchemaSDL(db);

// 2. Add custom resolvers
const customResolvers = {
  Query: {
    searchPosts: async (parent, args, context, info) => {
      // args.authorId will be resolved automatically
      return await db.query.post.findMany({
        where: and(
          eq(post.authorId, args.authorId), // Resolved value
          like(post.title, `%${args.searchTerm}%`)
        ),
      });
    },
  },
};

// 3. Combine and apply middleware
const allResolvers = {
  ...autoResolvers,
  Query: {
    ...autoResolvers.Query,
    ...customResolvers.Query,
  },
};

const composedResolvers = composeResolvers(allResolvers, {
  "*.*": [createExportMiddleware()], // Applies to ALL resolvers
});

// 4. Your custom resolvers now support export variables!
```

**Key Insight**: Export variables work transparently with custom resolvers. Just write normal resolvers and apply the export middleware - your resolvers will automatically receive resolved values and support the `@export` directive.

### Query Patterns

#### Pattern 1: GraphQL Variables (Recommended)

```graphql
query GetUserPosts($_authorId: ULID = "") {
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "$_authorId") # ← Must match GraphQL variable name
    name
  }
  posts: postFindMany(where: { authorId: { eq: $_authorId } }) {
    id
    title
  }
}
```

Call with:

```javascript
graphql({
  schema,
  source: query,
  variableValues: { _authorId: "" }, // Empty default, will be filled by export
  contextValue: {},
});
```

#### Pattern 2: Simple Export Keys

```graphql
query {
  user: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "authorId") # ← Simple key name
    name
  }
  # Note: Cannot directly use simple exports in GraphQL queries
  # Access via exportStore.get("authorId") in JavaScript
}
```

### Multiple Variables Example

```graphql
query SequencedExports($_userId: ULID = "", $_postId: ULID = "") {
  step1: userFindFirst(where: { email: { eq: "john@example.com" } }) {
    id @export(as: "$_userId") # ← Must match GraphQL variable name
    name
  }
  step2: postFindFirst(where: { authorId: { eq: $_userId } }) {
    id @export(as: "$_postId") # ← Must match GraphQL variable name
    title
  }
  step3: commentFindMany(where: { postId: { eq: $_postId } }) {
    id
    text
  }
}
```

Call with:

```javascript
graphql({
  schema,
  source: query,
  variableValues: {
    _userId: "", // Empty defaults, will be filled by exports
    _postId: "",
  },
  contextValue: {},
});
```

## Export Naming Patterns

You have **two different patterns** you can use for export directives:

### Pattern 1: GraphQL Variables with `$_` prefix (Recommended)

Use this pattern when you want to create **proper export-import chains** that work with GraphQL validation:

```graphql
query PostsAndTheirAuthors($_authorIds: [ID!] = [""]) @serial {
  # Step 1: Export TO GraphQL variable
  posts: postFindMany(where: { title: { like: "%Alice%" } }) {
    authorId @export(as: "$_authorIds") # ← Must match GraphQL variable name
  }

  # Step 2: Use GraphQL variable in next query
  authors: userFindMany(where: { id: { inArray: $_authorIds } }) {
    id
    name
  }
}
```

**Rules for GraphQL Variable Pattern:**

- **GraphQL variable**: `$_variableName` (declared in query signature)
- **Export directive**: `@export(as: "$_variableName")` (same name with `$_`)
- **Usage**: `$_variableName` (standard GraphQL variable syntax)

### Pattern 2: Simple Export Store Keys (Basic)

Use this pattern for **simple export storage** without GraphQL variable integration:

```graphql
query {
  users: userFindMany(where: { name: { in: ["Alice", "Bob"] } }) {
    id @export(as: "selectedUserIds") # ← Simple key name
    email @export(as: "selectedEmails") # ← No $_ prefix needed
  }
}
```

**Rules for Simple Pattern:**

- **Export directive**: `@export(as: "simpleKeyName")` (no `$_` prefix)
- **Access**: Only via `exportStore.get("simpleKeyName")` in JavaScript code
- **No GraphQL integration**: Cannot use these exports directly in other GraphQL queries

### Which Pattern Should You Use?

**✅ Use Pattern 1 (`$_` prefix)** when:

- You want export-import chains within the same GraphQL query
- You need GraphQL validation to work properly
- You want the full power of the export directive system

**✅ Use Pattern 2 (simple keys)** when:

- You only need to store values for JavaScript code to access later
- You don't need GraphQL variable integration
- You want simpler export names without special prefixes

## Why This Works

1. **FlexibleULID passes through `$_` patterns** - Bypasses scalar validation
2. **Variable type matches schema** - ULID variable for ULID field
3. **Middleware resolves at execution time** - After validation completes
4. **Supports multiple exports** - Dependencies create natural execution order
5. **Nested relation support** - Export variables are resolved during Drizzle query building phase (NEW!)
6. **Dual naming support** - Works with both `$_` GraphQL variables and simple export keys

## Key Features

### ✅ Top-Level Resolver Support

Export variables work in top-level queries:

```graphql
posts: postFindMany(where: { authorId: { eq: $userId } })
```

### ✅ Nested Relation Support (NEW!)

Export variables work in nested relation queries:

```graphql
sport: sportFindFirst(...) {
  posts(where: { cityId: { eq: $cityId } }) { ... }
}
```

### ✅ Multiple Variable Support

Handle complex dependencies:

```graphql
query($_userId: ID = "", $_postId: ID = "") {
  user: userFindFirst(...) { id @export(as: "$_userId") }
  post: postFindFirst(where: { authorId: { eq: $_userId } }) {
    id @export(as: "$_postId")
  }
  comments: commentFindMany(where: { postId: { eq: $_postId } }) { ... }
}
```

## Important Limitations

- **Exports only work within a single GraphQL operation** - Cannot share exports across multiple `graphql()` calls
- **Requires FlexibleULID for ULID fields** - Standard GraphQLULID will reject `$_` patterns
- **Must use variables** - Direct inline strings like `eq: "$_userId"` don't work
- **Execution order matters** - Exported values must be available before they're used (GraphQL handles this naturally)

## Why Resolver Composition?

The previous approach using schema transformation had a fundamental issue:

- GraphQL validates scalar types (like ULID) at **parse time**
- The `@export` directive works at **execution time**
- Standard scalars reject `$_userId` patterns before middleware can resolve them

Resolver composition with FlexibleULID solves this by:

1. **Accepting patterns during validation** - FlexibleULID allows `$_` strings through
2. **Running at execution time** - Middleware intercepts and resolves patterns
3. **Not interfering with normal ULIDs** - FlexibleULID validates standard ULID values

## Architecture

```
export-tool/
├── README.md           # This file
├── ExportStore.ts      # Store for exported values with Promise-based waiting
├── index.ts            # Main exports
├── middleware.ts       # Resolver composition middleware
└── utils.ts            # Helper functions

buildSchemaSDL/generator/utils/
└── selection.ts        # Enhanced with export variable resolution for nested relations
```

## How It Works

### 1. ExportStore

Manages exported values using Promises for synchronization:

```typescript
const store = new ExportStore();
store.set("userId", "123");
const userId = await store.waitFor("userId"); // Waits if not available yet
```

### 2. Resolver Middleware

Wraps each resolver with:

- **Pre-execution**: Check if arguments contain `$_varName` patterns and wait for those values
- **Post-execution**: Check if any fields in the selection set have `@export` directive and store those values

### 3. Nested Relation Support (NEW!)

The `extractRelationsParams` function in `buildSchemaSDL/generator/utils/selection.ts` now:

- **Detects export variables** in nested relation arguments (e.g., `posts(where: { cityId: { eq: $cityId } })`)
- **Resolves them asynchronously** using the same ExportStore from the GraphQL context
- **Waits for exported values** to become available before building the Drizzle query
- **Works recursively** for deeply nested relations

### 3. Usage

```typescript
import { buildSchemaSDL } from "drizzle-graphql";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { createExportMiddleware } from "drizzle-graphql/export-tool";

const { typeDefs, resolvers } = buildSchemaSDL(db);

// Add directive to schema
const extendedTypeDefs = `
  directive @export(as: String!) on FIELD
  ${typeDefs}
`;

// Compose resolvers with export middleware
const composedResolvers = composeResolvers(resolvers, {
  "*.*": [createExportMiddleware()],
});

const schema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: composedResolvers,
});
```

### 4. Query Example

```graphql
# GraphQL Variable Pattern (Recommended)
query ($_userId: ULID = "") {
  userFindFirst(where: { id: { eq: "01HXXX" } }) {
    id @export(as: "$_userId") # ← Must match GraphQL variable name
    name
  }
  postFindMany(where: { authorId: { eq: $_userId } }) {
    id
    title
  }
}

# Simple Export Pattern (JavaScript access only)
query {
  userFindFirst(where: { id: { eq: "01HXXX" } }) {
    id @export(as: "userId") # ← Simple key for JavaScript access
    name
  }
  # Cannot use simple exports directly in GraphQL
  # Access via: context.exportStore.get("userId")
}

# Nested relation export usage (NEW!)
query ($_cityId: ID = "") {
  cityFindFirst(where: { slug: { eq: "new-york" } }) {
    id @export(as: "$_cityId") # ← Must match GraphQL variable name
    name
  }
  sportWithPosts: sportFindFirst(where: { name: { eq: "Football" } }) {
    id
    name
    posts(where: { cityId: { eq: $_cityId } }) {
      id
      title
      cityId
    }
  }
}
```

## Implementation Plan

1. ✅ Create `ExportStore.ts` - Reuse from previous implementation
2. ✅ Create `middleware.ts` - Resolver composition wrapper
3. ✅ Create `utils.ts` - Helper functions for:
   - Detecting `$_varName` patterns in arguments
   - Resolving variables recursively in nested objects
   - Extracting `@export` directives from field selection
4. ✅ Create `index.ts` - Export public API
5. ✅ Add tests for the new approach
6. ✅ Update documentation
7. ✅ **Add nested relation support** - Enhanced `extractRelationsParams` to resolve export variables in nested queries

## Key Differences from Previous Approach

| Previous (Schema Transformation) | Current (Resolver Composition + Nested Support) |
| -------------------------------- | ----------------------------------------------- |
| Wraps schema fields              | Wraps resolver functions                        |
| Can't bypass scalar validation   | Works after validation                          |
| Uses `mapSchema`                 | Uses `composeResolvers`                         |
| Complex field-level wrapping     | Simple resolver wrapping                        |
| Hard to debug                    | Easy to debug                                   |
| No nested relation support       | ✅ **Full nested relation support**             |

## ⚠️ Direct String Limitation

**Direct string usage (e.g. `eq: "$_varName"`) will NOT work for strictly typed scalars.**

When you write a query like this:

```graphql
query {
  ...
  posts: postFindMany(where: { authorId: { eq: "$_userId" } }) { ... }
}
```

GraphQL validates `"$_userId"` against the scalar type (e.g. `Int` or `ULID`) **before** execution begins.

### The Solution: Variables + FlexibleULID

We solve this by using **GraphQL Variables** combined with our **FlexibleULID** scalar:

1.  **FlexibleULID**: A custom scalar that wraps standard validation but specifically **allows** strings starting with `$_`.
2.  **Variables**: By using a variable with a default value, we pass the pattern through the validation layer.

```graphql
query($id: ULID = "$_userId") { ... }
```

This allows the `$_userId` string to pass validation (thanks to `FlexibleULID`) and reach our middleware, which then swaps it for the real value.

### Supported Export Patterns

Following the LogRocket implementation, our @export should support:

1.  **Single value** - Export one field from one object

    ```graphql
    post(id: 1) {
      title @export(as: "postTitle")
    }
    ```

2.  **Array of values** - Export one field from multiple objects

    ```graphql
    posts(limit: 5) {
      title @export(as: "postTitles")
    }
    ```

3.  **Dictionary of values** - Export multiple fields from same object

    ```graphql
    post(id: 1) {
      title @export(as: "postData")
      content @export(as: "postData")
    }
    ```

4.  **Array of dictionaries** - Export multiple fields from multiple objects
    ```graphql
    posts(limit: 5) {
      title @export(as: "postsData")
      content @export(as: "postsData")
    }
    ```

## Benefits

✅ **Works with scalar validation** - Resolvers run after validation (but scalars are validated before)
✅ **Simpler implementation** - Less complex than schema transformation
✅ **Better debuggability** - Clear execution flow
✅ **More flexible** - Can modify arguments and results easily
✅ **Type-safe** - Preserves TypeScript types
✅ **Framework agnostic** - Works with any GraphQL server

## Test Results

- ✅ **ExportStore**: All tests pass
- ✅ **Utils**: All tests pass
- ✅ **Middleware**: All tests pass
- ✅ **Integration**: All tests pass (using Flexible Scalar + Variable approach)
- ✅ **Nested Relations**: All tests pass (export variables work in nested relation queries)

## Conclusion

This implementation provides a **fully functional @export directive** using resolver composition and a customized scalar, with complete support for nested relations.

The solution successfully overcomes the scalar validation issue by using `makeScalarAcceptExports`, which creates a scalar that accepts both valid values and `$_varName` strings during the validation phase.

**NEW**: The latest enhancement adds support for export variables in nested relation queries, making the export directive work seamlessly across all GraphQL query patterns.

Included features:

✅ **Flexible Scalars**: Helper factory to pass validation for export patterns
✅ **Resolver Middleware**: Intercepts execution to resolve variables and store exports
✅ **Recursive Resolution**: Supports nested fields and deep variable resolution
✅ **Variable Support**: Works with standard GraphQL variables
✅ **Nested Relations**: Export variables work in nested relation queries (sport.posts, user.profile, etc.)

### Recommendations

For **Production Use**:

1.  **Use the Variable Pattern**: Always use GraphQL variables (`$userId: ULID = ""`) combined with the default value `$_exportedName` pattern.
2.  **Flexible Scalars**: Ensure your schema uses scalars wrapped with `makeScalarAcceptExports` for fields that need to accept export patterns.
3.  **Nested Relations**: Export variables now work seamlessly in nested relations - no special configuration needed.

For **Limitations**:

- **Direct Strings**: You cannot use direct inline strings like `eq: "$_userId"` if the field type is strict (like `Int` or standard `ULID`). You must use the variable approach.
- **Single Request**: Exports share state only within the context of a single request.
- **Execution Order**: Exported values must be available before they're used (GraphQL's natural execution order handles this).

**Bottom Line**: This approach is now fully functional and tested for production use with the `drizzle-graphql` ecosystem, including complete support for nested relation queries.

## Next Steps

This package is ready for integration.

## Integration with GraphQL Yoga

Here is how to set it up with `graphql-yoga`:

```typescript
import { createYoga } from "graphql-yoga";
import { createServer } from "node:http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import { buildSchemaSDL } from "drizzle-graphql";
import {
  createExportMiddleware,
  makeScalarAcceptExports,
} from "drizzle-graphql/export-tool";
import { GraphQLULID } from "graphql-scalars";

// 1. Generate TypeDefs and Resolvers from Drizzle
const { typeDefs, resolvers } = buildSchemaSDL(db);

// 2. Add @export directive and Flexible Scalar to schema
const extendedTypeDefs = `
  directive @export(as: String!) on FIELD
  scalar ULID
  ${typeDefs}
`;

// 3. Override ULID scalar with Flexible version
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);

const resolverMap = {
  ...resolvers,
  ULID: FlexibleULID, // Important: Use FlexibleULID to allow $_ patterns!
};

// 4. Compose resolvers with middleware
const composedResolvers = composeResolvers(resolverMap, {
  "*.*": [createExportMiddleware()], // Apply to all fields
});

// 5. Create Schema
const schema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: composedResolvers,
});

// 6. Create Yoga Server
const yoga = createYoga({ schema });
const server = createServer(yoga);

server.listen(4000, () => {
  console.log("Server is running on http://localhost:4000/graphql");
});
```

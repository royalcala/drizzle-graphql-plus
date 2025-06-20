# Mutations in drizzle-graphql

This document explains how `drizzle-graphql` handles GraphQL mutations for database operations including inserts, updates, and deletes.

## Overview

The `drizzle-graphql` library automatically generates GraphQL mutations for all tables in your Drizzle schema. These mutations provide a type-safe way to perform CRUD operations while leveraging Drizzle ORM's features like data validation, type conversion, and conflict resolution.

## Generated Mutations

For each table in your schema, the library generates four types of mutations:

### 1. Insert Single Record
- **Name Pattern**: `insertInto{TableName}Single`
- **Purpose**: Insert a single record into the table
- **Returns**: The inserted record with selected fields

### 2. Insert Multiple Records
- **Name Pattern**: `insertInto{TableName}`  
- **Purpose**: Insert multiple records into the table
- **Returns**: Array of inserted records with selected fields (PostgreSQL/SQLite) or success status (MySQL)

### 3. Update Records
- **Name Pattern**: `update{TableName}`
- **Purpose**: Update existing records based on filter conditions
- **Returns**: Array of updated records with selected fields (PostgreSQL/SQLite) or success status (MySQL)

### 4. Delete Records
- **Name Pattern**: `deleteFrom{TableName}`
- **Purpose**: Delete records based on filter conditions  
- **Returns**: Array of deleted records with selected fields (PostgreSQL/SQLite) or success status (MySQL)

## Database-Specific Behavior

### PostgreSQL & SQLite
These databases support `RETURNING` clauses, so mutations return the actual affected records:

```typescript
// Returns actual inserted/updated/deleted records
return remapToGraphQLArrayOutput(result, tableName, table);
```

### MySQL
MySQL doesn't support `RETURNING` in all contexts, so mutations return a success status:

```typescript
// Returns { isSuccess: boolean }
return { isSuccess: true };
```

## Mutation Examples

### Schema Setup

```typescript
import { relations } from 'drizzle-orm';
import { pgTable, serial, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

const Users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

const Posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  authorId: integer('author_id').references(() => Users.id),
  publishedAt: timestamp('published_at'),
});

const Comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  postId: integer('post_id').references(() => Posts.id),
  authorId: integer('author_id').references(() => Users.id),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Insert Single Record

```graphql
mutation {
  insertIntoUsersSingle(
    values: {
      name: "John Doe"
      email: "john@example.com"
      isActive: true
    }
  ) {
    id
    name
    email
    isActive
    createdAt
  }
}
```

**Response (PostgreSQL/SQLite):**
```json
{
  "data": {
    "insertIntoUsersSingle": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "isActive": true,
      "createdAt": "2024-04-02T10:30:00.000Z"
    }
  }
}
```

### Insert Multiple Records

```graphql
mutation {
  insertIntoUsers(
    values: [
      {
        name: "Alice Smith"
        email: "alice@example.com"
      }
      {
        name: "Bob Johnson"
        email: "bob@example.com"
        isActive: false
      }
    ]
  ) {
    id
    name
    email
    isActive
    createdAt
  }
}
```

**Response (PostgreSQL/SQLite):**
```json
{
  "data": {
    "insertIntoUsers": [
      {
        "id": 2,
        "name": "Alice Smith",
        "email": "alice@example.com",
        "isActive": true,
        "createdAt": "2024-04-02T10:31:00.000Z"
      },
      {
        "id": 3,
        "name": "Bob Johnson",
        "email": "bob@example.com",
        "isActive": false,
        "createdAt": "2024-04-02T10:31:00.000Z"
      }
    ]
  }
}
```

### Update Records

```graphql
mutation {
  updateUsers(
    where: { 
      isActive: { eq: false } 
    }
    set: { 
      isActive: true 
    }
  ) {
    id
    name
    email
    isActive
  }
}
```

**Response (PostgreSQL/SQLite):**
```json
{
  "data": {
    "updateUsers": [
      {
        "id": 3,
        "name": "Bob Johnson", 
        "email": "bob@example.com",
        "isActive": true
      }
    ]
  }
}
```

### Delete Records

```graphql
mutation {
  deleteFromComments(
    where: {
      createdAt: { 
        lt: "2024-01-01T00:00:00.000Z" 
      }
    }
  ) {
    id
    content
    createdAt
  }
}
```

## Advanced Mutation Features

### 1. Complex Filtering

All mutations support the same filtering capabilities as queries:

```graphql
mutation {
  updatePosts(
    where: {
      OR: [
        { publishedAt: { isNull: true } }
        { title: { ilike: "%draft%" } }
      ]
    }
    set: {
      publishedAt: "2024-04-02T10:00:00.000Z"
    }
  ) {
    id
    title
    publishedAt
  }
}
```

### 2. Selective Field Return

You can specify exactly which fields to return after the mutation:

```graphql
mutation {
  insertIntoPostsSingle(
    values: {
      title: "My New Post"
      content: "This is the content of my new post."
      authorId: 1
    }
  ) {
    id        # Only return id and title
    title     # Skip content and other fields
  }
}
```

### 3. Data Type Handling

The library automatically handles data type conversions:

```graphql
mutation {
  insertIntoUsersSingle(
    values: {
      name: "Jane Doe"
      email: "jane@example.com"
      # Dates are automatically parsed
      createdAt: "2024-04-02T10:30:00.000Z"
      # JSON objects are stringified
      metadata: { role: "admin", permissions: ["read", "write"] }
      # Arrays are handled properly
      tags: ["developer", "admin"]
    }
  ) {
    id
    name
    createdAt
    metadata
    tags
  }
}
```

## Conflict Resolution

### PostgreSQL & SQLite

The library uses `onConflictDoNothing()` by default for insert operations:

```typescript
const result = await db.insert(table)
  .values(input)
  .returning(columns)
  .onConflictDoNothing();
```

This means if a record with the same unique constraint already exists, the insert will be silently ignored rather than throwing an error.

## Input Types and Validation

### Generated Input Types

For each table, the library generates input types:

- `{TableName}InsertInput` - For insert operations
- `{TableName}UpdateInput` - For update operations  
- `{TableName}Filters` - For where conditions

### Example Input Types

```typescript
// Generated for Users table
type UsersInsertInput = {
  id?: number;           // Optional for serial/auto-increment
  name: string;          // Required (notNull)
  email: string;         // Required (notNull)
  isActive?: boolean;    // Optional with default
  createdAt?: string;    // Optional with default
}

type UsersUpdateInput = {
  id?: number;           // All fields optional for updates
  name?: string;
  email?: string;  
  isActive?: boolean;
  createdAt?: string;
}
```

## Error Handling

### Validation Errors

```graphql
mutation {
  insertIntoUsersSingle(
    values: {
      # Missing required field 'name'
      email: "invalid-user@example.com"
    }
  ) {
    id
    name
    email
  }
}
```

**Error Response:**
```json
{
  "errors": [
    {
      "message": "null value in column \"name\" violates not-null constraint",
      "locations": [{"line": 2, "column": 3}],
      "path": ["insertIntoUsersSingle"]
    }
  ]
}
```

### Constraint Violations

```graphql
mutation {
  insertIntoUsersSingle(
    values: {
      name: "Duplicate User"
      email: "john@example.com"  # Email already exists
    }
  ) {
    id
    name
    email
  }
}
```

**Error Response:**
```json
{
  "errors": [
    {
      "message": "duplicate key value violates unique constraint \"users_email_unique\"",
      "locations": [{"line": 2, "column": 3}],
      "path": ["insertIntoUsersSingle"]
    }
  ]
}
```

## Performance Considerations

### 1. Batch Inserts

Use array mutations for inserting multiple records efficiently:

```graphql
# Efficient - Single query with multiple values
mutation {
  insertIntoUsers(
    values: [
      { name: "User 1", email: "user1@example.com" }
      { name: "User 2", email: "user2@example.com" }
      { name: "User 3", email: "user3@example.com" }
    ]
  ) {
    id
    name
  }
}
```

Instead of multiple single inserts:

```graphql
# Inefficient - Multiple separate queries
mutation {
  user1: insertIntoUsersSingle(values: { name: "User 1", email: "user1@example.com" }) { id }
  user2: insertIntoUsersSingle(values: { name: "User 2", email: "user2@example.com" }) { id }
  user3: insertIntoUsersSingle(values: { name: "User 3", email: "user3@example.com" }) { id }
}
```

### 2. Selective Updates

Only update the fields that actually changed:

```graphql
mutation {
  updateUsers(
    where: { id: { eq: 1 } }
    set: { 
      isActive: false  # Only update this field
    }
  ) {
    id
    isActive  # Only return necessary fields
  }
}
```

### 3. Efficient Filtering

Use indexed columns in where conditions:

```graphql
mutation {
  deleteFromComments(
    where: { 
      authorId: { eq: 123 }  # Use indexed foreign key
    }
  ) {
    id
  }
}
```

## Best Practices

### 1. Transaction Handling

For complex operations requiring multiple mutations, consider using database transactions outside of GraphQL:

```typescript
// In your application code
await db.transaction(async (tx) => {
  const user = await tx.insert(Users).values({ name: "John", email: "john@example.com" }).returning();
  await tx.insert(Posts).values({ title: "First Post", authorId: user[0].id });
});
```

### 2. Input Validation

While Drizzle provides database-level validation, consider adding application-level validation:

```typescript
// Custom resolver with validation
const customCreateUser = async (parent, args, context) => {
  // Validate email format
  if (!isValidEmail(args.values.email)) {
    throw new GraphQLError('Invalid email format');
  }
  
  // Call generated mutation
  return await context.generated.mutations.insertIntoUsersSingle(parent, args, context);
};
```

### 3. Audit Logging

Track mutation operations for audit purposes:

```typescript
const auditLogResolver = (originalResolver) => {
  return async (parent, args, context, info) => {
    const result = await originalResolver(parent, args, context, info);
    
    // Log the mutation
    await logMutation({
      operation: info.fieldName,
      userId: context.user?.id,
      timestamp: new Date(),
      data: args
    });
    
    return result;
  };
};
```

### 4. Rate Limiting

Implement rate limiting for mutation operations:

```typescript
import { shield, rule, and, or, rateLimit } from 'graphql-shield';

const rateLimitRule = rateLimit({
  identifyContext: (ctx) => ctx.user?.id || ctx.req.ip,
  max: 100,
  window: '15m'
});

const permissions = shield({
  Mutation: {
    insertIntoUsers: rateLimitRule,
    insertIntoUsersSingle: rateLimitRule,
  }
});
```

## Conclusion

The `drizzle-graphql` library provides comprehensive mutation support that:

✅ **Automatically generates type-safe mutations for all tables**  
✅ **Supports all CRUD operations with filtering and validation**  
✅ **Handles database-specific differences transparently**  
✅ **Provides flexible return types and field selection**  
✅ **Integrates seamlessly with Drizzle ORM features**  
✅ **Offers robust error handling and conflict resolution**

This makes it easy to build reliable GraphQL APIs with full mutation support while maintaining the performance and type safety benefits of Drizzle ORM.

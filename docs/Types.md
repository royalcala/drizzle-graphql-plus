# Type System and Schema Translation

This document explains how `drizzle-graphql` translates Drizzle ORM schema definitions into GraphQL types, providing a comprehensive overview of the type conversion system and schema generation process.

## Overview

The `drizzle-graphql` library automatically analyzes your Drizzle ORM schema and generates a complete GraphQL type system including:

- **Output Types**: For query results and mutations
- **Input Types**: For mutations and filtering
- **Enum Types**: From Drizzle enum definitions
- **Filter Types**: For complex where conditions
- **Order Types**: For sorting operations
- **Relation Types**: For nested data structures

## Type Translation Process

### 1. Schema Analysis

The library first analyzes your Drizzle schema to extract:

```typescript
// Extract tables from schema
const tableEntries = schemaEntries.filter(([key, value]) => is(value, PgTable));

// Extract relations from schema  
const rawRelations = schemaEntries
  .filter(([key, value]) => is(value, Relations))
  .map(([key, value]) => [tableName, value.config(createTableRelationsHelpers(table))]);
```

### 2. Column Type Conversion

Each Drizzle column type is mapped to appropriate GraphQL types:

```typescript
function columnToGraphQLCore(column: Column): ConvertedColumn {
  switch (column.dataType) {
    case 'boolean': return { type: GraphQLBoolean };
    case 'string': return { type: GraphQLString };
    case 'number': return { type: GraphQLInt | GraphQLFloat };
    case 'date': return { type: GraphQLString };
    case 'json': return { type: GraphQLString };
    case 'bigint': return { type: GraphQLString };
    case 'buffer': return { type: GraphQLList(GraphQLInt) };
    case 'array': return { type: GraphQLList(innerType) };
  }
}
```

## Drizzle to GraphQL Type Mapping

### Basic Types

| Drizzle Type | GraphQL Type | Description | Example |
|--------------|--------------|-------------|---------|
| `text()` | `String` | Text strings | `"Hello World"` |
| `varchar()` | `String` | Variable character strings | `"user@example.com"` |
| `char()` | `String` | Fixed character strings | `"US"` |
| `integer()` | `Int` | 32-bit integers | `42` |
| `serial()` | `Int` | Auto-incrementing integers | `1, 2, 3...` |
| `real()` | `Float` | Floating point numbers | `3.14159` |
| `numeric()` | `Float` | Decimal numbers | `99.99` |
| `boolean()` | `Boolean` | True/false values | `true` |
| `date()` | `String` | ISO date strings | `"2024-04-02"` |
| `timestamp()` | `String` | ISO datetime strings | `"2024-04-02T10:30:00.000Z"` |
| `bigint()` | `String` | Large integers as strings | `"9007199254740991"` |
| `json()` | `String` | JSON as strings | `"{\"key\": \"value\"}"` |

### Complex Types

#### Arrays
```typescript
// Drizzle schema
integer('tags').array()           // GraphQL: [Int!]!
text('categories').array()        // GraphQL: [String!]!

// PostgreSQL vectors
vector('embedding', { dimensions: 5 })  // GraphQL: [Float!]!
```

#### Buffers
```typescript
// Drizzle schema  
blob('data')                      // GraphQL: [Int!]! (array of bytes)
```

#### Enums
```typescript
// Drizzle schema
export const roleEnum = pgEnum('role', ['admin', 'user']);
role: roleEnum('role')

// Generated GraphQL enum
enum UsersRoleEnum {
  admin
  user
}
```

#### Geometry (PostgreSQL)
```typescript
// Drizzle schema
geometry('location', { mode: 'xy' })     // GraphQL: PgGeometryObject { x: Float, y: Float }
geometry('bounds', { mode: 'tuple' })    // GraphQL: [Float, Float]
```

### Nullability Rules

The library automatically determines GraphQL field nullability based on Drizzle column constraints:

```typescript
// Drizzle schema
text('name').notNull()              // GraphQL: String!
text('description')                 // GraphQL: String
integer('age').notNull().default(0) // GraphQL: Int (nullable in inputs due to default)
```

## Generated Type Categories

### 1. Output Types (Query Results)

#### Table Item Types
For each table, generates a main output type:

```typescript
// From Users table
type UsersSelectItem = {
  id: Int!
  name: String!
  email: String
  createdAt: String!
  isActive: Boolean
  // ... relation fields
  posts: [PostsSelectItem!]!
  profile: ProfileSelectItem
}
```

#### Relation Types
For nested relations, generates specific relation types:

```typescript
// For Users.posts relation
type UsersPostsRelation = {
  id: Int!
  title: String!
  content: String
  publishedAt: String
}
```

### 2. Input Types (Mutations & Filters)

#### Insert Input Types
```typescript
// For Users table
input UsersInsertInput {
  id: Int            # Optional for auto-increment
  name: String!      # Required
  email: String      # Optional
  createdAt: String  # Optional (has default)
  isActive: Boolean  # Optional (has default)
}
```

#### Update Input Types
```typescript
// All fields optional for updates
input UsersUpdateInput {
  id: Int
  name: String
  email: String
  createdAt: String
  isActive: Boolean
}
```

#### Filter Input Types
```typescript
input UsersFilters {
  id: UsersIdFilters
  name: UsersNameFilters
  email: UsersEmailFilters
  createdAt: UsersCreatedAtFilters
  isActive: UsersIsActiveFilters
  OR: [UsersFiltersOr!]
}

input UsersNameFilters {
  eq: String
  ne: String
  like: String
  ilike: String
  notLike: String
  notIlike: String
  inArray: [String!]
  notInArray: [String!]
  isNull: Boolean
  isNotNull: Boolean
  OR: [UsersNameFiltersOr!]
}
```

#### Order Input Types
```typescript
input UsersOrderBy {
  id: InnerOrder
  name: InnerOrder
  email: InnerOrder
  createdAt: InnerOrder
}

input InnerOrder {
  direction: OrderDirection!  # asc | desc
  priority: Int!              # For multi-column sorting
}
```

## Schema Generation Examples

### Complete Example

```typescript
// Drizzle Schema
import { relations } from 'drizzle-orm';
import { pgTable, serial, text, integer, timestamp, boolean, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user', 'moderator']);

export const Users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: roleEnum('role').default('user'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  metadata: json('metadata'),
});

export const Posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  authorId: integer('author_id').references(() => Users.id),
  tags: text('tags').array(),
  publishedAt: timestamp('published_at'),
});

export const usersRelations = relations(Users, ({ many }) => ({
  posts: many(Posts),
}));

export const postsRelations = relations(Posts, ({ one }) => ({
  author: one(Users, { fields: [Posts.authorId], references: [Users.id] }),
}));
```

### Generated GraphQL Schema

```graphql
# Enums
enum UsersRoleEnum {
  admin
  user
  moderator
}

enum OrderDirection {
  asc
  desc
}

# Output Types
type UsersSelectItem {
  id: Int!
  name: String!
  email: String!
  role: UsersRoleEnum
  isActive: Boolean
  createdAt: String
  metadata: String
  posts(
    where: PostsFilters
    orderBy: PostsOrderBy
    offset: Int
    limit: Int
  ): [PostsSelectItem!]!
}

type PostsSelectItem {
  id: Int!
  title: String!
  content: String
  authorId: Int
  tags: [String!]
  publishedAt: String
  author(where: UsersFilters): UsersSelectItem
}

# Relation Types
type UsersPostsRelation {
  id: Int!
  title: String!
  content: String
  authorId: Int
  tags: [String!]
  publishedAt: String
}

type PostsAuthorRelation {
  id: Int!
  name: String!
  email: String!
  role: UsersRoleEnum
  isActive: Boolean
  createdAt: String
  metadata: String
}

# Input Types
input UsersInsertInput {
  id: Int
  name: String!
  email: String!
  role: UsersRoleEnum
  isActive: Boolean
  createdAt: String
  metadata: String
}

input UsersUpdateInput {
  id: Int
  name: String
  email: String
  role: UsersRoleEnum
  isActive: Boolean
  createdAt: String
  metadata: String
}

input PostsInsertInput {
  id: Int
  title: String!
  content: String
  authorId: Int
  tags: [String!]
  publishedAt: String
}

# Filter Types
input UsersFilters {
  id: UsersIdFilters
  name: UsersNameFilters
  email: UsersEmailFilters
  role: UsersRoleFilters
  isActive: UsersIsActiveFilters
  createdAt: UsersCreatedAtFilters
  metadata: UsersMetadataFilters
  OR: [UsersFiltersOr!]
}

input UsersNameFilters {
  eq: String
  ne: String
  like: String
  ilike: String
  notLike: String
  notIlike: String
  inArray: [String!]
  notInArray: [String!]
  isNull: Boolean
  isNotNull: Boolean
  OR: [UsersNameFiltersOr!]
}

# Order Types
input UsersOrderBy {
  id: InnerOrder
  name: InnerOrder
  email: InnerOrder
  role: InnerOrder
  isActive: InnerOrder
  createdAt: InnerOrder
  metadata: InnerOrder
}

input InnerOrder {
  direction: OrderDirection!
  priority: Int!
}

# Root Types
type Query {
  users(
    where: UsersFilters
    orderBy: UsersOrderBy
    offset: Int
    limit: Int
  ): [UsersSelectItem!]!
  
  usersSingle(
    where: UsersFilters
    orderBy: UsersOrderBy
    offset: Int
  ): UsersSelectItem
  
  posts(
    where: PostsFilters
    orderBy: PostsOrderBy
    offset: Int
    limit: Int
  ): [PostsSelectItem!]!
  
  postsSingle(
    where: PostsFilters
    orderBy: PostsOrderBy
    offset: Int
  ): PostsSelectItem
}

type Mutation {
  insertIntoUsers(values: [UsersInsertInput!]!): [UsersSelectItem!]!
  insertIntoUsersSingle(values: UsersInsertInput!): UsersSelectItem
  updateUsers(set: UsersUpdateInput!, where: UsersFilters): [UsersSelectItem!]!
  deleteFromUsers(where: UsersFilters): [UsersSelectItem!]!
  
  insertIntoPosts(values: [PostsInsertInput!]!): [PostsSelectItem!]!
  insertIntoPostsSingle(values: PostsInsertInput!): PostsSelectItem
  updatePosts(set: PostsUpdateInput!, where: PostsFilters): [PostsSelectItem!]!
  deleteFromPosts(where: PostsFilters): [PostsSelectItem!]!
}
```

## Advanced Type Features

### 1. Enum Handling

The library handles both PostgreSQL enums and text enums:

```typescript
// PostgreSQL enum
export const status = pgEnum('status', ['active', 'inactive', 'pending']);

// Text enum
status: text('status', { enum: ['draft', 'published', 'archived'] })

// Both generate GraphQL enums with proper naming
enum TableStatusEnum {
  active
  inactive  
  pending
}
```

### 2. Special PostgreSQL Types

#### Vectors
```typescript
// Drizzle
vector('embedding', { dimensions: 1536 })

// GraphQL
embedding: [Float!]  # Array of floats

// Usage
{
  posts(where: { embedding: { eq: [0.1, 0.2, 0.3] } }) {
    title
    embedding
  }
}
```

#### Geometry
```typescript
// Drizzle
geometry('location', { mode: 'xy' })
geometry('bounds', { mode: 'tuple' })

// GraphQL
type PgGeometryObject {
  x: Float!
  y: Float!
}

location: PgGeometryObject
bounds: [Float, Float]

// Usage
{
  locations {
    name
    location { x, y }
    bounds
  }
}
```

### 3. Caching and Performance

The type generation system uses WeakMap caching for performance:

```typescript
// Cached type generation
const enumMap = new WeakMap<Object, GraphQLEnumType>();
const fieldMap = new WeakMap<Object, Record<string, ConvertedColumn>>();
const filterMap = new WeakMap<Object, Record<string, ConvertedInputColumn>>();
const orderMap = new WeakMap<Object, Record<string, ConvertedInputColumn>>();
```

This ensures that:
- Types are generated only once per table/column
- Memory usage is optimized
- Performance remains fast for large schemas

### 4. Relation Type Generation

The library generates specialized types for relations:

```typescript
// For a Users.posts relation
type UsersPostsRelation {
  // Only includes direct table fields, not nested relations
  id: Int!
  title: String!
  content: String
  authorId: Int
}

// Main table type includes relations
type UsersSelectItem {
  id: Int!
  name: String!
  posts: [PostsSelectItem!]!  # Full type with nested relations
}
```

## Data Transformation

### Input Transformation

When receiving GraphQL input, the library transforms data for Drizzle:

```typescript
// GraphQL input
{
  name: "John Doe",
  createdAt: "2024-04-02T10:30:00.000Z",
  metadata: "{\"role\": \"admin\"}",
  tags: ["typescript", "graphql"]
}

// Transformed for Drizzle
{
  name: "John Doe",
  createdAt: new Date("2024-04-02T10:30:00.000Z"),
  metadata: { role: "admin" },  // Parsed JSON
  tags: ["typescript", "graphql"]
}
```

### Output Transformation

When returning data from Drizzle, the library transforms for GraphQL:

```typescript
// From Drizzle
{
  name: "John Doe",
  createdAt: Date(2024-04-02T10:30:00.000Z),
  metadata: { role: "admin" },
  buffer: Buffer.from([1, 2, 3]),
  bigintValue: BigInt("9007199254740991")
}

// Transformed for GraphQL
{
  name: "John Doe", 
  createdAt: "2024-04-02T10:30:00.000Z",     // ISO string
  metadata: "{\"role\": \"admin\"}",         // JSON string
  buffer: [1, 2, 3],                         // Array of numbers
  bigintValue: "9007199254740991"            // String
}
```

## Configuration Options

### Relation Depth Limiting

```typescript
const { schema } = buildSchema(db, { 
  relationsDepthLimit: 3  // Prevent infinitely deep relations
});
```

This prevents stack overflow and performance issues with circular or deeply nested relations.

### Custom Type Names

The library follows consistent naming patterns:

- **Output Types**: `{TableName}SelectItem`
- **Input Types**: `{TableName}InsertInput`, `{TableName}UpdateInput`
- **Filter Types**: `{TableName}Filters`
- **Order Types**: `{TableName}OrderBy`
- **Enum Types**: `{TableName}{ColumnName}Enum`
- **Relation Types**: `{TableName}{RelationName}Relation`

## Best Practices

### 1. Schema Design

```typescript
// Good: Clear, descriptive names
export const Users = pgTable('users', {
  id: serial('id').primaryKey(),
  fullName: text('full_name').notNull(),
  emailAddress: text('email_address').notNull().unique(),
});

// Generated GraphQL field names will be clean:
// id, fullName, emailAddress
```

### 2. Enum Usage

```typescript
// Prefer PostgreSQL enums for better type safety
export const userRole = pgEnum('user_role', ['admin', 'user', 'moderator']);

// Over text enums
role: text('role', { enum: ['admin', 'user', 'moderator'] })
```

### 3. Default Values

```typescript
// Use defaults to make fields optional in insert inputs
isActive: boolean('is_active').default(true),
createdAt: timestamp('created_at').defaultNow(),
role: userRole('role').default('user'),
```

### 4. Indexing

```typescript
// Consider GraphQL query patterns when adding indexes
email: text('email').notNull().unique(),  // Common filter field
authorId: integer('author_id')            // Foreign key for relations
  .references(() => Users.id)
  .notNull(),
```

## Conclusion

The `drizzle-graphql` type system provides:

✅ **Automatic type generation** from Drizzle schemas  
✅ **Comprehensive type coverage** for all operations  
✅ **Type safety** maintained from database to GraphQL  
✅ **Performance optimization** through caching  
✅ **Flexible configuration** for different use cases  
✅ **Database-specific features** like PostgreSQL arrays and geometry  
✅ **Consistent naming patterns** for predictable APIs  

This automatic type generation eliminates the need for manual GraphQL schema definition while ensuring full type safety and feature coverage for your database operations.

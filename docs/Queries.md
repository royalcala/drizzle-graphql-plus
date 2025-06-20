# Query Optimization and N+1 Problem Prevention

This document explains how `drizzle-graphql` handles GraphQL queries efficiently and prevents the common N+1 problem that can occur with GraphQL APIs.

## Overview

The `drizzle-graphql` library automatically generates optimized database queries by analyzing GraphQL query structure and leveraging Drizzle ORM's relational query capabilities. This ensures that complex nested queries are executed efficiently without performance issues.

## N+1 Problem Prevention

### What is the N+1 Problem?

The N+1 problem occurs when:
1. You fetch N parent records (1 query)
2. For each parent record, you fetch related child records (N additional queries)
3. Total: 1 + N queries instead of a single optimized query

### How drizzle-graphql Solves This

The library prevents N+1 problems through several key mechanisms:

#### 1. Single Query with Relations (WITH clause)

The library uses Drizzle ORM's relational query API with the `with` parameter to fetch all related data in a single database query:

```typescript
const query = queryBase.findMany({
    columns: extractSelectedColumnsFromTree(parsedInfo.fieldsByTypeName[typeName]!, table),
    offset,
    limit, 
    orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
    where: where ? extractFilters(table, tableName, where) : undefined,
    with: relationMap[tableName]
        ? extractRelationsParams(relationMap, tables, tableName, parsedInfo, typeName)
        : undefined,
});
```

#### 2. GraphQL Query Analysis

The library uses `graphql-parse-resolve-info` to analyze the incoming GraphQL query and determine exactly which fields and relationships are requested:

```typescript
const parsedInfo = parseResolveInfo(info, { deep: true }) as ResolveTree;
```

#### 3. Intelligent Relation Parameter Extraction

The `extractRelationsParams` function recursively builds the relationship structure based on the GraphQL query, ensuring that:
- Only requested relations are fetched
- Nested relations are handled properly
- Filters, ordering, and pagination are applied to relations

## Example: Complex Nested Relations

### Schema Setup

```typescript
import { relations } from 'drizzle-orm';
import { pgTable, serial, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

// Tables
const Posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  authorId: integer('author_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

const Comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  postId: integer('post_id').references(() => Posts.id),
  authorId: integer('author_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

const Reactions = pgTable('reactions', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'like', 'dislike', 'love', etc.
  commentId: integer('comment_id').references(() => Comments.id),
  userId: integer('user_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

const Users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

// Relations
const postsRelations = relations(Posts, ({ one, many }) => ({
  author: one(Users, { fields: [Posts.authorId], references: [Users.id] }),
  comments: many(Comments),
}));

const commentsRelations = relations(Comments, ({ one, many }) => ({
  post: one(Posts, { fields: [Comments.postId], references: [Posts.id] }),
  author: one(Users, { fields: [Comments.authorId], references: [Users.id] }),
  reactions: many(Reactions),
}));

const reactionsRelations = relations(Reactions, ({ one }) => ({
  comment: one(Comments, { fields: [Reactions.commentId], references: [Comments.id] }),
  user: one(Users, { fields: [Reactions.userId], references: [Users.id] }),
}));

const usersRelations = relations(Users, ({ many }) => ({
  posts: many(Posts),
  comments: many(Comments),
  reactions: many(Reactions),
}));
```

### GraphQL Query Example

```graphql
{
  posts {
    id
    title
    content
    createdAt
    author {
      id
      name
      email
    }
    comments {
      id
      content
      createdAt
      author {
        id
        name
      }
      reactions {
        id
        type
        createdAt
        user {
          id
          name
        }
      }
    }
  }
}
```

### How it Works (No N+1)

#### Traditional Approach (N+1 Problem):
```sql
-- 1. Fetch all posts
SELECT * FROM posts;

-- 2. For each post, fetch author (N queries)
SELECT * FROM users WHERE id = ?;
SELECT * FROM users WHERE id = ?;
-- ... N times

-- 3. For each post, fetch comments (N queries)  
SELECT * FROM comments WHERE post_id = ?;
SELECT * FROM comments WHERE post_id = ?;
-- ... N times

-- 4. For each comment, fetch author (M queries)
SELECT * FROM users WHERE id = ?;
-- ... M times

-- 5. For each comment, fetch reactions (M queries)
SELECT * FROM reactions WHERE comment_id = ?;
-- ... M times

-- 6. For each reaction, fetch user (P queries)
SELECT * FROM users WHERE id = ?;
-- ... P times

-- Total: 1 + N + N + M + M + P queries!
```

#### drizzle-graphql Approach (Single Optimized Query):

The library generates a single Drizzle query that fetches all the data:

```typescript
await db.query.Posts.findMany({
  with: {
    author: true,
    comments: {
      with: {
        author: true,
        reactions: {
          with: {
            user: true
          }
        }
      }
    }
  }
});
```

This translates to optimized SQL with JOINs or efficient subqueries, fetching all related data in **one database roundtrip**.

## Query Features

### 1. Selective Field Fetching

Only requested fields are fetched from the database:

```graphql
{
  posts {
    id        # Only these fields
    title     # are fetched from
    content   # the posts table
  }
}
```

### 2. Relation Filtering

Relations can have their own filters, limits, and ordering:

```graphql
{
  posts {
    id
    title
    comments(
      where: { content: { ilike: "%important%" } }, 
      limit: 5,
      orderBy: { createdAt: { direction: desc } }
    ) {
      id
      content
      reactions(where: { type: { eq: "like" } }) {
        id
        type
      }
    }
  }
}
```

### 3. Depth Limiting

Configure `relationsDepthLimit` to prevent overly deep queries:

```typescript
import { buildSchema } from 'drizzle-graphql';

const { schema } = buildSchema(db, { 
  relationsDepthLimit: 3  // Prevent queries deeper than 3 levels
});
```

### 4. Pagination Support

Both top-level and relation queries support pagination:

```graphql
{
  posts(limit: 10, offset: 20) {
    id
    title
    comments(limit: 5, offset: 0) {
      id
      content
      reactions(limit: 10) {
        id
        type
      }
    }
  }
}
```

## Performance Benefits

✅ **Eliminates N+1 queries completely**  
✅ **Reduces database roundtrips to minimum**  
✅ **Optimizes data fetching based on GraphQL query structure**  
✅ **Supports complex nested relations efficiently**  
✅ **Maintains type safety with TypeScript**  
✅ **Automatic query optimization without manual intervention**

## Implementation Details

### Query Resolution Process

1. **Parse GraphQL Query**: The resolver receives the GraphQL query and uses `graphql-parse-resolve-info` to analyze the requested fields and relations.

2. **Extract Relations**: The `extractRelationsParams` function recursively walks through the query structure to build the complete relationship tree.

3. **Generate Single Query**: A single Drizzle query is constructed with all necessary `with` clauses for the requested relations.

4. **Execute and Transform**: The query is executed, and results are transformed to match the expected GraphQL response format.

### Key Functions

- `extractSelectedColumnsFromTree()`: Determines which columns to select based on GraphQL field selection
- `extractRelationsParams()`: Builds nested relation parameters from GraphQL query structure  
- `extractFilters()`: Converts GraphQL where arguments to Drizzle filters
- `extractOrderBy()`: Converts GraphQL orderBy arguments to Drizzle ordering

## Best Practices

### 1. Define Relations Properly

Always define bidirectional relations in your schema:

```typescript
const postsRelations = relations(Posts, ({ one, many }) => ({
  author: one(Users, { fields: [Posts.authorId], references: [Users.id] }),
  comments: many(Comments),
}));

const commentsRelations = relations(Comments, ({ one, many }) => ({
  post: one(Posts, { fields: [Comments.postId], references: [Posts.id] }),
  reactions: many(Reactions),
}));
```

### 2. Use Appropriate Depth Limits

Set reasonable depth limits to prevent abuse:

```typescript
const { schema } = buildSchema(db, { relationsDepthLimit: 4 });
```

### 3. Monitor Query Performance

While N+1 is prevented, complex queries with many relations can still be expensive. Monitor your database performance and consider:
- Adding appropriate database indexes
- Using pagination for large result sets
- Implementing query complexity analysis

### 4. Leverage Filtering

Use relation filters to reduce data transfer:

```graphql
{
  posts {
    id
    title
    comments(where: { createdAt: { gte: "2024-01-01" } }) {
      id
      content
    }
  }
}
```

## Conclusion

The `drizzle-graphql` library provides automatic N+1 problem prevention through intelligent query analysis and optimization. By leveraging Drizzle ORM's relational query capabilities, it ensures that even complex nested GraphQL queries are executed efficiently with minimal database roundtrips.

This approach provides the flexibility of GraphQL while maintaining the performance characteristics of well-optimized database queries, making it an excellent choice for building high-performance GraphQL APIs.

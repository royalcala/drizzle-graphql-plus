# Test Server for Interface Fragments

This is a test server to verify that interface fragments work correctly with the Drizzle-GraphQL library.

## Setup

1. **Install dependencies** (from root):

   ```bash
   pnpm install
   ```

2. **Seed the database**:

   ```bash
   pnpm tsx test-server/seed.ts
   ```

3. **Start the server**:

   ```bash
   pnpm tsx test-server/server.ts
   ```

4. **Open GraphiQL**:
   Visit http://localhost:4000/graphql

## Test Queries

### Basic Interface Fragment

```graphql
query {
  users {
    ...UserFragment
  }
}

fragment UserFragment on UserFields {
  id
  name
  email
}
```

### Nested Interface Fragments

```graphql
query {
  users {
    ...UserInfo
    posts {
      ...PostInfo
      comments {
        ...CommentInfo
        user {
          ...UserInfo
        }
      }
    }
  }
}

fragment UserInfo on UserFields {
  id
  name
  email
}

fragment PostInfo on PostFields {
  id
  title
}

fragment CommentInfo on CommentFields {
  id
  text
}
```

### Deep Nesting with Circular Relations

```graphql
query {
  posts {
    ...PostInfo
    author {
      ...UserInfo
      posts(limit: 3) {
        ...PostInfo
      }
    }
    comments {
      ...CommentInfo
      user {
        ...UserInfo
      }
      post {
        ...PostInfo
      }
    }
  }
}

fragment UserInfo on UserFields {
  id
  name
  email
}

fragment PostInfo on PostFields {
  id
  title
  content
}

fragment CommentInfo on CommentFields {
  id
  text
}
```

### Mixed: Direct Fields + Interface Fragments

```graphql
query {
  users {
    ...UserBasic
    bio
    posts {
      ...PostBasic
      content
    }
  }
}

fragment UserBasic on UserFields {
  id
  name
}

fragment PostBasic on PostFields {
  id
  title
}
```

### Mutation with Interface Fragment

```graphql
mutation {
  insertIntoUsersSingle(
    values: {
      name: "New User"
      email: "newuser@example.com"
      bio: "Just testing"
    }
  ) {
    ...UserInfo
  }
}

fragment UserInfo on UserFields {
  id
  name
  email
  bio
}
```

## Expected Behavior

All queries should:

1. ✅ Return data without errors
2. ✅ Include all fields from interface fragments
3. ✅ Work with nested relations
4. ✅ Handle circular references correctly
5. ✅ Not return null for non-nullable fields

If you see errors like "Cannot return null for non-nullable field", the interface fragment extraction is not working properly.

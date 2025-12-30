# DataLoader Tests

This directory contains comprehensive tests for the DataLoader-enhanced version of `buildSchemaSDL`.

## Test Files

- **`resolvers.test.ts`** - Main test suite covering DataLoader functionality
- **`schema.ts`** - Test database schema with relations
- **`seed.ts`** - Database seeding script for test data
- **`server-sdl.ts`** - Test server with DataLoader enabled

## Running Tests

### 1. Setup Test Database

First, create and seed the test database:

```bash
# Create database tables
npx drizzle-kit push --dialect=sqlite --schema=./src/build-schema-sdl-with-dl/tests/schema.ts --url=file:src/build-schema-sdl-with-dl/tests/test-resolvers.db

# Seed test data
npx tsx src/build-schema-sdl-with-dl/tests/seed.ts
```

### 2. Run Tests

```bash
# Run DataLoader tests
npm run test:dataloader

# Or run specific test file
npx vitest run src/build-schema-sdl-with-dl/tests/resolvers.test.ts
```

### 3. Start Test Server

```bash
# Start the DataLoader test server
npx tsx src/build-schema-sdl-with-dl/tests/server-sdl.ts
```

The server will be available at `http://localhost:4001/graphql`

## Test Coverage

### DataLoader Performance Tests
- **Batching verification** - Ensures relations are batched efficiently
- **Deep nested relations** - Tests recursive DataLoader usage
- **Performance comparison** - Demonstrates query optimization

### Query Resolvers with DataLoader
- **Basic queries** - Standard CRUD operations with DataLoader
- **Filtered queries** - Where clauses with DataLoader optimization
- **Nested relations** - Complex relational queries

### Mutation Resolvers with DataLoader
- **Insert operations** - Creating records with optimized result fetching
- **Update operations** - Updating records with nested relation loading
- **Delete operations** - Deletion with efficient cleanup queries

### One-to-One Relations
- **Profile relations** - User-profile one-to-one relationships
- **Filtered relations** - One-to-one with where clauses
- **Null handling** - Proper null returns for filtered relations

### Export Tool Integration
- **Export with DataLoader** - Export directive working with batched queries
- **Complex nested exports** - Multi-level export scenarios
- **Performance with exports** - Ensuring exports don't break DataLoader optimization

### Performance Tests
- **Multi-user scenarios** - Testing with multiple users and posts
- **Query timing** - Measuring DataLoader performance improvements
- **Memory usage** - Verifying proper cleanup

## Key Differences from Original Tests

1. **DataLoader Context**: All queries include DataLoader context setup and cleanup
2. **Performance Focus**: Additional tests specifically for DataLoader performance
3. **Batching Verification**: Tests ensure relations are actually batched
4. **Memory Management**: Proper DataLoader cleanup after each test

## Expected Performance Improvements

With DataLoader enabled, you should see:

- **Reduced query count**: N+1 queries become batched queries
- **Faster response times**: Especially for queries with multiple relations
- **Better scalability**: Performance doesn't degrade with more related data

## Example Performance Comparison

```
Without DataLoader:
- Query 100 users with posts: 101 queries (1 + 100)
- Query time: ~500ms

With DataLoader:
- Query 100 users with posts: 2 queries (1 + 1 batched)
- Query time: ~50ms
```

## Debugging DataLoader

To debug DataLoader behavior:

1. **Enable logging** in DataLoader context
2. **Check query counts** in your database logs
3. **Use GraphiQL** to test complex queries
4. **Monitor memory usage** during tests

## Common Issues

1. **Context not passed**: Ensure DataLoader context is included in all GraphQL executions
2. **Cleanup not called**: Always cleanup DataLoader context after requests
3. **Database instance missing**: DataLoader resolvers need access to the database instance

## Integration with CI/CD

These tests can be integrated into your CI/CD pipeline:

```yaml
# Example GitHub Actions step
- name: Run DataLoader Tests
  run: |
    npx drizzle-kit push --dialect=sqlite --schema=./src/build-schema-sdl-with-dl/tests/schema.ts --url=file:src/build-schema-sdl-with-dl/tests/test-resolvers.db
    npx tsx src/build-schema-sdl-with-dl/tests/seed.ts
    npx vitest run src/build-schema-sdl-with-dl/tests/resolvers.test.ts
```
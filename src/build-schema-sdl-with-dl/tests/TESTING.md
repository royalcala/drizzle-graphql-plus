# DataLoader Testing Guide

This guide explains how to test the DataLoader-enhanced version of `buildSchemaSDL`.

## Quick Start

```bash
# 1. Setup and run DataLoader tests
npm run test:dataloader

# 2. Start DataLoader test server
npm run test-server-dataloader
```

## Available Scripts

### Test Scripts
- `npm run test:dataloader` - Run all DataLoader tests
- `npm run test-server-dataloader:db:push` - Setup test database
- `npm run test-server-dataloader:seed` - Seed test data
- `npm run test-server-dataloader` - Start test server with DataLoader

### Manual Setup
```bash
# Create database
npx drizzle-kit push --dialect=sqlite --schema=./src/build-schema-sdl-with-dl/tests/schema.ts --url=file:src/build-schema-sdl-with-dl/tests/test-resolvers.db

# Seed data
npx tsx src/build-schema-sdl-with-dl/tests/seed.ts

# Run tests
npx vitest run src/build-schema-sdl-with-dl/tests/resolvers.test.ts

# Start server
npx tsx src/build-schema-sdl-with-dl/tests/server-sdl.ts
```

## Test Categories

### 1. DataLoader Performance Tests
Tests that verify DataLoader is actually batching queries and improving performance.

### 2. Query Resolvers with DataLoader
Standard query tests but with DataLoader optimization enabled.

### 3. Mutation Resolvers with DataLoader
Mutation tests that verify DataLoader works with insert/update/delete operations.

### 4. One-to-One Relations
Tests for one-to-one relationships using DataLoader.

### 5. Export Tool Integration
Tests that verify the export directive works correctly with DataLoader.

### 6. Performance Comparison
Tests that demonstrate the performance benefits of DataLoader.

## Key Features Tested

✅ **Batching**: Relations are batched instead of N+1 queries  
✅ **Caching**: Duplicate requests are cached within the same request  
✅ **Nested Relations**: Deep nested relations work with DataLoader  
✅ **Filtered Relations**: Where clauses work with DataLoader  
✅ **Export Directive**: Export tool integration with DataLoader  
✅ **Memory Management**: Proper cleanup of DataLoader context  
✅ **Performance**: Measurable performance improvements  

## Expected Results

With DataLoader enabled, you should see:

- **Fewer database queries**: N+1 becomes batched queries
- **Faster response times**: Especially with nested relations
- **Better scalability**: Performance doesn't degrade with more data
- **Memory efficiency**: Proper cleanup prevents memory leaks

## Comparing with Original Tests

The DataLoader tests are based on the original `test-server/resolvers.test.ts` but with these enhancements:

1. **DataLoader Context**: Every query includes DataLoader context setup/cleanup
2. **Performance Focus**: Additional tests specifically for DataLoader performance
3. **Batching Verification**: Tests ensure relations are actually batched
4. **Memory Management**: Proper DataLoader cleanup after each test

## Debugging DataLoader Issues

If tests fail or DataLoader isn't working:

1. **Check Context**: Ensure DataLoader context is passed to all GraphQL executions
2. **Verify Cleanup**: Make sure `cleanupDataLoaderContext()` is called
3. **Database Access**: Ensure `db` instance is available in context
4. **Query Logs**: Enable database query logging to see actual queries
5. **Memory Usage**: Monitor memory usage during tests

## Integration with CI/CD

Example GitHub Actions workflow:

```yaml
- name: Test DataLoader
  run: |
    npm run test-server-dataloader:db:push
    npm run test-server-dataloader:seed
    npm run test:dataloader
```

## Performance Benchmarking

The tests include performance benchmarks that measure:

- Query execution time
- Number of database queries
- Memory usage
- Response size

Example results:
```
Without DataLoader: 101 queries, 500ms
With DataLoader: 2 queries, 50ms
Performance improvement: 10x faster, 50x fewer queries
```
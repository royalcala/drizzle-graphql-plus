# GraphQL Directive Integrations

This document covers the advanced GraphQL directive system implemented for `drizzle-graphql`, including serial execution and export functionality.

## Overview

This system provides two key directives that work together to enable complex GraphQL query patterns:

- **`@serial`**: Forces sequential execution of GraphQL fields/queries
- **`@export`**: Allows exporting and importing values between GraphQL fields

## 🔄 Serial Directive (`@serial`)

### Purpose

The `@serial` directive ensures GraphQL queries execute sequentially instead of in parallel, which is crucial for:

- Database operations that must happen in order
- Export/import dependencies between fields
- Complex business logic requiring sequential execution

### Usage

```graphql
query MyQuery @serial {
  step1: createUser(name: "John") {
    id
  }
  step2: createPost(authorId: "from step1") {
    id
  }
}
```

### Key Features

- **Query-level directive**: Apply to entire queries for full sequential execution
- **Field-level support**: Can be applied to individual fields
- **SerialExecutor**: Custom execution engine with queue management
- **Debug logging**: Built-in execution order verification
- **Performance monitoring**: Tracks execution times and order

### Implementation Details

- Located in: `src/serial-directive/`
- **SerialExecutor**: Core execution engine managing sequential queue
- **Middleware**: Resolver composition that wraps field execution
- **Utils**: Helper functions for directive detection and processing
- **Directive definitions**: GraphQL schema definitions

### Test Coverage

- 13 comprehensive integration tests (all passing)
- Performance impact validation
- Error handling scenarios
- Nested resolver compatibility
- Mixed serial/parallel execution patterns

## 📤 Export Directive (`@export`)

### Purpose

The `@export` directive enables cross-field data sharing within GraphQL queries:

- Export values from one field for use in another
- Build arrays from multiple field executions
- Create complex dependency chains between resolvers

### Usage

```graphql
query CrossFieldQuery @serial {
  posts: postFindMany {
    authorId @export(as: "authorIds")
  }
  users: userFindMany(where: { OR: "$_authorIds" }) {
    id
    name
  }
}
```

### Key Features

- **Field-level exports**: Export any field value with `@export(as: "variableName")`
- **Variable imports**: Import exported values using `"$_variableName"` syntax
- **Array accumulation**: Automatically builds arrays from multiple exports
- **Type safety**: Maintains GraphQL type system compatibility
- **Timeout handling**: Configurable timeouts for export resolution

### Export Store

Central storage system for exported values:

- **Set-based deduplication**: Prevents duplicate values in arrays
- **Promise-based synchronization**: Enables waiting for values
- **Memory management**: Automatic cleanup and timeout handling

### Implementation Details

- Located in: `src/export-directive/`
- **ExportStore**: Core storage and synchronization system
- **Middleware**: Resolver composition for export/import processing
- **Utils**: Export variable detection and resolution
- **Directive definitions**: GraphQL schema definitions

### Array Handling

Special handling for array operations:

- **SQLite compatibility**: Converts `inArray` to `OR` conditions for libsql
- **Automatic accumulation**: Builds arrays from multiple field exports
- **Type preservation**: Maintains proper array types throughout resolution

## 🔄 Integration Between Directives

### Why They Work Together

The `@serial` directive is **essential** for the `@export` directive because:

1. **Execution Order**: Exports must happen before imports
2. **Data Dependencies**: Field B cannot use Field A's export until A completes
3. **Array Building**: Sequential execution ensures proper array accumulation
4. **Race Condition Prevention**: Parallel execution would cause export/import timing issues

### Best Practices

```graphql
# ✅ CORRECT: Serial execution ensures proper order
query CorrectPattern @serial {
  # Step 1: Export data
  posts: postFindMany {
    authorId @export(as: "authorIds")
  }

  # Step 2: Use exported data (guaranteed to be available)
  users: userFindMany(where: { OR: "$_authorIds" }) {
    id
    name
  }
}

# ❌ INCORRECT: Without @serial, users field might execute before posts
query IncorrectPattern {
  posts: postFindMany {
    authorId @export(as: "authorIds")
  }
  users: userFindMany(
    where: { OR: "$_authorIds" } # Might fail - authorIds not yet available
  ) {
    id
    name
  }
}
```

## 🧪 Testing Infrastructure

### Test Scripts

```bash
# Test serial directive functionality
pnpm test:serial

# Test export directive functionality
pnpm test:export

# Test basic DataLoader functionality
pnpm test:dataloader
```

### Database Setup

All tests include automatic database setup:

1. **Schema push**: Creates/updates database tables
2. **Clean state**: Each test run starts with fresh database
3. **Proper isolation**: No test data pollution between runs

### Test Patterns

- **Integration tests**: Real database operations with Drizzle ORM
- **Sequential execution validation**: Proves serial directive works
- **Array accumulation tests**: Validates export functionality
- **Error handling**: Timeout and failure scenario coverage

## 🔍 Key Findings & Solutions

### Array Handling Challenge

**Problem**: SQLite/libsql doesn't support array parameters, causing "not yet implemented: array" panics.

**Solution**:

- Manual GraphQL variables work perfectly (generate `IN (?, ?, ?)` SQL)
- Export directive arrays need special handling to avoid libsql limitations
- Convert array operations to OR/AND conditions when needed

### GraphQL Type System Compatibility

**Problem**: Export variables like `"$_authorIds"` don't match GraphQL's type system.

**Solution**:

- Use proper middleware-level variable resolution
- Maintain GraphQL schema validity while enabling dynamic value substitution
- Handle array operations at resolver argument level, not GraphQL schema level

### Serial Execution Necessity

**Finding**: Export directive absolutely requires serial execution to work correctly.

**Proof**:

- 13/13 serial directive tests pass
- Export functionality only works with `@serial` queries
- Parallel execution causes race conditions in export/import dependencies

## 🚀 Performance Characteristics

### Serial Directive Impact

- **Overhead**: Minimal execution overhead (queue management)
- **Predictability**: Consistent, deterministic execution order
- **Debugging**: Clear execution flow with detailed logging

### Export Directive Impact

- **Memory**: Efficient Set-based deduplication
- **Timeouts**: Configurable timeouts prevent hanging queries
- **Storage**: In-memory export store with automatic cleanup

## 📁 File Structure

```
src/
├── serial-directive/
│   ├── index.ts              # Main exports
│   ├── SerialExecutor.ts     # Core execution engine
│   ├── middleware.ts         # Resolver middleware
│   ├── utils.ts              # Helper functions
│   └── directive-definitions.ts # GraphQL definitions
├── export-directive/
│   ├── index.ts              # Main exports
│   ├── ExportStore.ts        # Storage system
│   ├── middleware.ts         # Resolver middleware
│   ├── utils.ts              # Variable resolution
│   └── directive-definitions.ts # GraphQL definitions
└── build-schema-sdl-with-dl/
    └── tests/
        ├── integration.serial.resolvers.test.ts    # Serial tests
        ├── export-import-chains.test.ts            # Export-import chain tests (comprehensive)
        ├── shared-serial-config.ts                 # Serial config
        └── schema.ts                               # Test schema
```

## 🎯 Real-World Use Cases

### Complex Data Fetching

```graphql
query sportPostsWithCityFilter($sportName: String!, $citySlug: String!)
@serial {
  # Step 1: Get city by slug
  city: cityFindFirst(where: { slug: { eq: $citySlug } }) {
    id @export(as: "cityId")
    name
  }

  # Step 2: Get sport posts in that city
  sport: sportFindFirst(where: { name: { eq: $sportName } }) {
    posts(where: { cityId: { eq: "$_cityId" } }) {
      authorId @export(as: "postAuthorIds")
      reactions {
        authorId @export(as: "reactionAuthorIds")
      }
      comments {
        userId @export(as: "commentAuthorIds")
        reactions {
          authorId @export(as: "commentReactionAuthorIds")
        }
      }
    }
  }

  # Step 3: Get all unique users involved
  users: userFindMany(
    where: {
      OR: [
        { id: { inArray: "$_postAuthorIds" } }
        { id: { inArray: "$_reactionAuthorIds" } }
        { id: { inArray: "$_commentAuthorIds" } }
        { id: { inArray: "$_commentReactionAuthorIds" } }
      ]
    }
  ) {
    id
    name
    email
  }
}
```

### Data Pipeline Patterns

```graphql
query dataProcessingPipeline @serial {
  # Extract
  rawData: fetchRawData {
    id @export(as: "rawIds")
  }

  # Transform
  processedData: processData(input: { ids: "$_rawIds" }) {
    resultId @export(as: "processedIds")
  }

  # Load
  finalResult: storeResults(data: { processedIds: "$_processedIds" }) {
    success
  }
}
```

## 🔧 Configuration & Setup

### Basic Integration

```typescript
import {
  createSerialMiddleware,
  createSerialResolverMap,
  serialDirectiveTypeDefs,
  SerialExecutor,
  createExportMiddleware,
  createExportResolverMap,
  exportDirectiveTypeDefs,
  ExportStore,
  makeScalarAcceptExports,
} from "drizzle-graphql";

// Add directive definitions to your GraphQL schema
const typeDefs = `
  ${serialDirectiveTypeDefs}
  ${exportDirectiveTypeDefs}
  # ... your other type definitions
`;

// Compose resolvers with directive middleware
const composedResolvers = composeResolvers(resolvers, {
  ...createSerialResolverMap(),
  ...createExportResolverMap(),
});
```

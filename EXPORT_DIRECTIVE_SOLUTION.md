# Export Directive Solution

## The Issue

You were experiencing a problem where your GraphQL query with the `@export` directive was returning `null` for the `postsBySportAndCity` query. The issue was caused by two main problems:

1. **Incorrect syntax**: Using `$_varName` directly in the query string instead of using GraphQL variables
2. **Null handling**: When the first query returns null, the export directive never executes, causing dependent queries to timeout

## The Solution

### 1. Correct Syntax Pattern

**❌ Incorrect (what you were doing):**
```graphql
query postsBySportAndCity($sportName: String!, $citySlug: String!) {
  cityFindFirst(where: {slug: {eq: $citySlug}}) {
    id @export(as: "cityId")
  }
  sportWithPosts: sportFindFirst(where: {name: {eq: $sportName}}) {
    posts(limit: 2, where: {cityId: {eq: $_cityId}}) {  # ❌ Wrong!
      id
    }
  }
}
```

**✅ Correct (what you should do):**
```graphql
query postsBySportAndCity($sportName: String!, $citySlug: String!, $cityId: ID = "") {
  cityFindFirst(where: {slug: {eq: $citySlug}}) {
    id @export(as: "cityId")
  }
  sportWithPosts: sportFindFirst(where: {name: {eq: $sportName}}) {
    posts(limit: 2, where: {cityId: {eq: $cityId}}) {  # ✅ Use GraphQL variable
      id
    }
  }
}
```

**Variables:**
```javascript
{
  sportName: "Football",
  citySlug: "new-york",
  cityId: "$_cityId"  // ✅ Pass the export pattern as a variable value
}
```

### 2. Key Changes Made to Fix the Issue

We fixed the export tool to handle null values gracefully:

1. **Modified `ExportStore.waitFor()`** to accept an `allowNull` parameter that resolves with `null` instead of timing out
2. **Updated `resolveExportVariables()`** to use `allowNull: true` by default
3. **Fixed `middleware.ts`** to export null values (not just non-null values)

### 3. Complete Working Example

```typescript
import { executeQueryWithExport } from './your-graphql-setup';

const query = `
  query postsBySportAndCity($sportName: String!, $citySlug: String!, $cityId: ID = "") {
    cityFindFirst(where: {slug: {eq: $citySlug}}) {
      id @export(as: "cityId")
      name
    }
    sportWithPosts: sportFindFirst(where: {name: {eq: $sportName}}) {
      id
      name
      posts(limit: 2, where: {cityId: {eq: $cityId}}) {
        id
        title
        cityId
      }
    }
  }
`;

const result = await executeQueryWithExport(query, {
  sportName: "Football",
  citySlug: "new-york", 
  cityId: "$_cityId"  // This will be replaced with the exported cityId
});

console.log(result);
// Output:
// {
//   cityFindFirst: { id: "city123", name: "New York" },
//   sportWithPosts: {
//     id: "sport456",
//     name: "Football",
//     posts: [
//       { id: "post1", title: "Game 1", cityId: "city123" },
//       { id: "post2", title: "Game 2", cityId: "city123" }
//     ]
//   }
// }
```

### 4. Handling Null Cases

If the city doesn't exist, the export will resolve to `null`, and the posts query will handle it gracefully:

```typescript
const result = await executeQueryWithExport(query, {
  sportName: "Football",
  citySlug: "nonexistent-city",
  cityId: "$_cityId"  // This will resolve to null
});

console.log(result);
// Output:
// {
//   cityFindFirst: null,
//   sportWithPosts: {
//     id: "sport456", 
//     name: "Football",
//     posts: []  // Empty array when filtering by null
//   }
// }
```

### 5. Alternative Pattern for Better Null Handling

If you want more control over null handling, you can use conditional logic:

```graphql
query postsBySportAndCity($sportName: String!, $citySlug: String!, $cityId: ID = "", $fallbackCityId: ID = "default") {
  cityFindFirst(where: {slug: {eq: $citySlug}}) {
    id @export(as: "cityId")
    name
  }
  sportWithPosts: sportFindFirst(where: {name: {eq: $sportName}}) {
    id
    name
    posts(limit: 2, where: {
      or: [
        {cityId: {eq: $cityId}},
        {cityId: {eq: $fallbackCityId}}
      ]
    }) {
      id
      title
      cityId
    }
  }
}
```

## Summary

The key points to remember:

1. **Use GraphQL variables with default values** instead of `$_varName` directly in queries
2. **Pass export patterns as variable values**: `{ cityId: "$_cityId" }`
3. **The export tool now handles null gracefully** - no more timeouts when exports don't happen
4. **Test your queries** with both existing and non-existent data to ensure proper behavior

Your original query should now work correctly with these changes!
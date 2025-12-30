import { createYoga, useEnvelop } from 'graphql-yoga';
import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute, subscribe } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { buildSchemaSDLWithDataLoader, useDataLoaderCleanup } from 'drizzle-graphql-plus';

// Example usage with GraphQL Yoga and Envelop
export function createServerWithDataLoader(db: any) {
  // Build your schema with DataLoader enabled (always enabled in this version)
  const { typeDefs, resolvers } = buildSchemaSDLWithDataLoader(db);
  
  // Create executable schema
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // Create Envelop instance with comprehensive DataLoader plugin
  const getEnveloped = envelop({
    plugins: [
      useEngine({ execute, subscribe }),
      useSchema(schema),
      useDataLoaderCleanup({ db }), // Handles context creation, db injection, AND cleanup automatically
    ],
  });

  const yoga = createYoga({
    plugins: [useEnvelop(getEnveloped)],
    context: async ({ request }) => {
      // DataLoader context AND database are automatically injected by the plugin!
      // Just add your other context properties
      return {
        request,
        // db and relationLoaders are added automatically by the plugin
      };
    },
  });

  return yoga;
}

// Example query that benefits from DataLoader:
/*
query GetPostsWithComments {
  postFindMany(limit: 10) {
    id
    title
    content
    comments(limit: 5) {  # This will be batched with DataLoader
      id
      content
      author {            # Nested relations also batched
        id
        name
      }
    }
    author {              # This will also be batched
      id
      name
      email
    }
  }
}

Without DataLoader:
- 1 query for posts
- N queries for comments (one per post)
- M queries for comment authors (one per comment)
- N queries for post authors (one per post)
Total: 1 + N + M + N queries

With DataLoader:
- 1 query for posts
- 1 batched query for all comments
- 1 batched query for all comment authors
- 1 batched query for all post authors
Total: 4 queries regardless of N and M
*/
import { createYoga } from 'graphql-yoga';
import { buildSchemaSDL } from '../src/build-schema-sdl-with-dl';
import { createDataLoaderContext, cleanupDataLoaderContext } from '../src/build-schema-sdl-with-dl/generator/utils/context';

// Example usage with GraphQL Yoga
export function createServerWithDataLoader(db: any) {
  // Build your schema with DataLoader enabled (default in this version)
  const { typeDefs, resolvers } = buildSchemaSDL(db, {
    relationsDepthLimit: 5,
    // DataLoader is enabled by default, but you can explicitly set it
    useDataLoader: true
  });

  const yoga = createYoga({
    typeDefs,
    resolvers,
    context: async ({ request }) => {
      // Create DataLoader context for each request
      const dataLoaderContext = createDataLoaderContext();
      
      return {
        // Your existing context
        request,
        // Add DataLoader context
        ...dataLoaderContext,
        
        // Cleanup function (optional, for manual cleanup)
        cleanup: () => cleanupDataLoaderContext(dataLoaderContext)
      };
    },
    plugins: [
      // Plugin to automatically cleanup DataLoaders after each request
      {
        onRequestResult: ({ result }) => {
          // Cleanup DataLoaders after request completion
          if (result.context?.cleanup) {
            result.context.cleanup();
          }
        }
      }
    ]
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
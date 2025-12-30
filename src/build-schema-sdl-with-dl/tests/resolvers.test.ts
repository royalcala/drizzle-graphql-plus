import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL } from "../index";
import * as schema from "./schema";
import { user, post, comment, reaction, userProfile, city, sport } from "./schema";
import { ulid as generateUlid } from "ulid";
import { graphql, GraphQLSchema } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLULID } from "graphql-scalars";
import { eq } from "drizzle-orm";
import { composeResolvers } from "@graphql-tools/resolvers-composition";
import {
  createExportMiddleware,
  ExportStore,
  makeScalarAcceptExports,
} from "../../../src/export-tool";
import { createDataLoaderContext, cleanupDataLoaderContext } from "../generator/utils/context";

// Create test database client
const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test-resolvers.db",
});

const db = drizzle(client, { schema });

// Build GraphQL schema with DataLoader always enabled
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Create executable schema
const customTypeDefinitions = `enum ReactionType { LIKE DISLIKE }`;
const extendedTypeDefs = customTypeDefinitions + "\n" + typeDefs;

const resolversWithScalars = { ...resolvers };
let executableSchema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: resolversWithScalars,
});

// Create FlexibleID using the new factory function (validates ULID format and supports exports)
GraphQLULID.name = "ID";
const ID = makeScalarAcceptExports(GraphQLULID);

// Wrap resolvers with export middleware AND add FlexibleID scalar
const composedResolvers = composeResolvers(
  {
    ...resolvers,
    ID,
  },
  {
    "*.*": [createExportMiddleware()],
  }
);
let executableSchemaWithExport = makeExecutableSchema({
  typeDefs: extendedTypeDefs + "\ndirective @export(as: String!) on FIELD",
  resolvers: composedResolvers,
});

// Helper to execute GraphQL queries with DataLoader context
async function executeQuery(query: string, variables?: Record<string, any>) {
  const dataLoaderContext = createDataLoaderContext();

  try {
    const result = await graphql({
      schema: executableSchema,
      source: query,
      variableValues: variables,
      contextValue: {
        db, // Add database instance for DataLoader resolvers
        ...dataLoaderContext,
      },
    });

    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  } finally {
    // Cleanup DataLoader context
    cleanupDataLoaderContext(dataLoaderContext);
  }
}

// Helper to execute GraphQL queries with export-tool enabled and DataLoader
async function executeQueryWithExport(
  query: string,
  variables?: Record<string, any>,
  context?: any
) {
  const dataLoaderContext = createDataLoaderContext();
  const combinedContext = {
    db, // Add database instance
    ...dataLoaderContext,
    ...(context || {}),
  };

  try {
    const result = await graphql({
      schema: executableSchemaWithExport,
      source: query,
      variableValues: variables,
      contextValue: combinedContext,
    });

    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  } finally {
    // Cleanup DataLoader context
    cleanupDataLoaderContext(dataLoaderContext);
  }
}

describe("DataLoader Resolver Tests", () => {
  const testData = {
    userId: generateUlid(),
    postId: generateUlid(),
    commentId: generateUlid(),
    reactionId: generateUlid(),
    profileId: generateUlid(),
    testEmail: `test-${generateUlid()}@example.com`, // Unique email per test run
  };

  beforeAll(async () => {
    // Seed test data
    await db.insert(user).values({
      id: testData.userId,
      name: "Test User",
      email: testData.testEmail,
      bio: "Test bio",
    });

    await db.insert(post).values({
      id: testData.postId,
      title: "Test Post",
      content: "Test content",
      authorId: testData.userId,
    });

    await db.insert(comment).values({
      id: testData.commentId,
      text: "Test comment",
      postId: testData.postId,
      userId: testData.userId,
    });

    await db.insert(reaction).values({
      id: testData.reactionId,
      commentId: testData.commentId,
      userId: testData.userId,
      type: "LIKE",
    });

    await db.insert(userProfile).values({
      id: testData.profileId,
      userId: testData.userId,
      bio: "Test user profile bio",
      avatarUrl: "https://example.com/avatar.jpg",
      website: "https://example.com",
    });
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(reaction);
    await db.delete(comment);
    await db.delete(post);
    await db.delete(userProfile);
    await db.delete(user);
  });

  describe("DataLoader Query Performance Tests", () => {
    it("should use DataLoader for batching relation queries", async () => {
      // This test verifies that DataLoader is working by checking that
      // multiple users with their posts are fetched efficiently
      const data = await executeQuery(`
        query {
          userFindMany(limit: 3) {
            id
            name
            email
            posts {
              id
              title
              content
              comments {
                id
                text
                user {
                  id
                  name
                }
              }
            }
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.userFindMany).toBeDefined();
      expect(Array.isArray(data?.userFindMany)).toBe(true);

      // Verify nested relations are loaded
      const users = data?.userFindMany as any[];
      if (users.length > 0) {
        expect(users[0]).toHaveProperty("posts");
        expect(Array.isArray(users[0].posts)).toBe(true);

        // If there are posts, verify comments are loaded
        if (users[0].posts.length > 0) {
          expect(users[0].posts[0]).toHaveProperty("comments");
          expect(Array.isArray(users[0].posts[0].comments)).toBe(true);
        }
      }
    });

    it("should handle deep nested relations with DataLoader", async () => {
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            posts {
              id
              title
              comments {
                id
                text
                reactions {
                  id
                  type
                  user {
                    id
                    name
                  }
                }
              }
            }
            profile {
              id
              bio
              avatarUrl
            }
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      const user = (data?.userFindMany as any[])[0];

      // Verify all nested relations are loaded
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.profile).toBeDefined();

      if (user.posts.length > 0) {
        const post = user.posts[0];
        expect(post.comments).toBeDefined();
        expect(Array.isArray(post.comments)).toBe(true);

        if (post.comments.length > 0) {
          const comment = post.comments[0];
          expect(comment.reactions).toBeDefined();
          expect(Array.isArray(comment.reactions)).toBe(true);
        }
      }
    });
  });

  describe("DataLoader Query Resolvers", () => {
    it("should query users with DataLoader optimization", async () => {
      const data = await executeQuery(`
        query {
          userFindMany {
            id
            name
            email
            bio
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.userFindMany).toBeDefined();
      expect(Array.isArray(data?.userFindMany)).toBe(true);
      expect((data?.userFindMany as any[]).length).toBeGreaterThan(0);
      expect((data?.userFindMany as any[])[0]).toHaveProperty("id");
      expect((data?.userFindMany as any[])[0]).toHaveProperty("name");
    });

    it("should query users with where filter using DataLoader", async () => {
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            email
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      expect((data?.userFindMany as any[])[0].id).toBe(testData.userId);
      expect((data?.userFindMany as any[])[0].name).toBe("Test User");
    });

    it("should query posts with author relation WITHOUT selecting authorId (foreign key)", async () => {
      // This test specifically verifies the fix for the issue where
      // querying post.author would return null if authorId wasn't explicitly selected
      const data = await executeQuery(`
        query {
          postFindMany {
            id
            title
            author {
              id
              name
            }
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.postFindMany).toBeDefined();
      expect(Array.isArray(data?.postFindMany)).toBe(true);

      const posts = data?.postFindMany as any[];
      if (posts.length > 0) {
        // Verify that author is properly loaded even though authorId wasn't selected
        expect(posts[0]).toHaveProperty("author");
        expect(posts[0].author).not.toBeNull();
        expect(posts[0].author).toHaveProperty("id");
        expect(posts[0].author).toHaveProperty("name");

        // Verify that authorId is NOT in the response (GraphQL field selection working)
        expect(posts[0]).not.toHaveProperty("authorId");
      }
    });

    it("should query posts with nested relations using DataLoader", async () => {
      const data = await executeQuery(`
        query {
          postFindMany {
            id
            title
            content
            author {
              id
              name
            }
            comments {
              id
              text
              user {
                id
                name
              }
            }
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.postFindMany).toBeDefined();
      expect(Array.isArray(data?.postFindMany)).toBe(true);

      const posts = data?.postFindMany as any[];
      if (posts.length > 0) {
        expect(posts[0]).toHaveProperty("author");
        expect(posts[0]).toHaveProperty("comments");
        expect(Array.isArray(posts[0].comments)).toBe(true);
      }
    });

    it("should handle multiple nested filters with DataLoader", async () => {
      // This test verifies that complex nested filtering works correctly
      // with our DataLoader approach that selects all columns
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindMany(where: { name: { like: "%Test%" } }) {
            id
            name
            email
            posts(where: { title: { like: "%Test%" } }, limit: 2) {
              id
              title
              content
              author(where: { id: { eq: $userId } }) {
                id
                name
                email
              }
              comments(where: { text: { like: "%comment%" } }, limit: 1) {
                id
                text
                user(where: { name: { like: "%Test%" } }) {
                  id
                  name
                }
                reactions(where: { type: { eq: LIKE } }) {
                  id
                  type
                  user(where: { id: { eq: $userId } }) {
                    id
                    name
                  }
                }
              }
            }
            profile(where: { bio: { like: "%profile%" } }) {
              id
              bio
              avatarUrl
            }
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data).toBeDefined();
      expect(data?.userFindMany).toBeDefined();
      expect(Array.isArray(data?.userFindMany)).toBe(true);

      const users = data?.userFindMany as any[];
      if (users.length > 0) {
        const user = users[0];

        // Verify user level filtering worked
        expect(user.name).toContain("Test");

        // Verify posts are filtered and limited
        expect(user.posts).toBeDefined();
        expect(Array.isArray(user.posts)).toBe(true);
        expect(user.posts.length).toBeLessThanOrEqual(2);

        if (user.posts.length > 0) {
          const post = user.posts[0];
          expect(post.title).toContain("Test");

          // Verify author filtering (should match the user ID filter)
          if (post.author) {
            expect(post.author.id).toBe(testData.userId);
          }

          // Verify comments are filtered and limited
          if (post.comments && post.comments.length > 0) {
            expect(post.comments.length).toBeLessThanOrEqual(1);
            const comment = post.comments[0];
            expect(comment.text).toContain("comment");

            // Verify nested user filtering
            if (comment.user) {
              expect(comment.user.name).toContain("Test");
            }

            // Verify reactions filtering
            if (comment.reactions && comment.reactions.length > 0) {
              comment.reactions.forEach((reaction: any) => {
                expect(reaction.type).toBe("LIKE");

                // Verify deeply nested user filtering
                if (reaction.user) {
                  expect(reaction.user.id).toBe(testData.userId);
                }
              });
            }
          }
        }

        // Verify profile filtering
        if (user.profile) {
          expect(user.profile.bio).toContain("profile");
        }
      }
    });
  });

  describe("DataLoader Mutation Resolvers", () => {
    it("should insert a new user and use DataLoader for result fetching", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          userInsertMany(values: $values) {
            id
            name
            email
            posts {
              id
              title
            }
          }
        }
        `,
        {
          values: [
            {
              name: "DataLoader User",
              email: "dataloader@example.com",
            },
          ],
        }
      );

      expect(data?.userInsertMany as any[]).toHaveLength(1);
      expect((data?.userInsertMany as any[])[0].name).toBe("DataLoader User");
      expect((data?.userInsertMany as any[])[0]).toHaveProperty("id");
      expect((data?.userInsertMany as any[])[0]).toHaveProperty("posts");
      expect(Array.isArray((data?.userInsertMany as any[])[0].posts)).toBe(true);

      // Cleanup
      const insertedId = (data?.userInsertMany as any[])[0].id;
      await db.delete(user).where(eq(user.id, insertedId));
    });

    it("should update user and fetch with nested relations using DataLoader", async () => {
      const data = await executeQuery(
        `
        mutation($set: UserUpdateInput!, $where: UserFilters) {
          userUpdateMany(set: $set, where: $where) {
            id
            name
            posts {
              id
              title
              comments {
                id
                text
              }
            }
            profile {
              id
              bio
            }
          }
        }
        `,
        {
          set: { name: "Updated DataLoader User" },
          where: { id: { eq: testData.userId } },
        }
      );

      expect(data?.userUpdateMany as any[]).toHaveLength(1);
      expect((data?.userUpdateMany as any[])[0].id).toBe(testData.userId);
      expect((data?.userUpdateMany as any[])[0].name).toBe("Updated DataLoader User");
      expect((data?.userUpdateMany as any[])[0]).toHaveProperty("posts");
      expect((data?.userUpdateMany as any[])[0]).toHaveProperty("profile");

      // Restore original data
      await db
        .update(user)
        .set({ name: "Test User" })
        .where(eq(user.id, testData.userId));
    });
  });

  describe("DataLoader One-to-One Relations", () => {
    it("should query user with profile using DataLoader (one-to-one)", async () => {
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            profile {
              id
              bio
              avatarUrl
              website
            }
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      const user = (data?.userFindMany as any[])[0];
      expect(user.id).toBe(testData.userId);
      expect(user.profile).toBeDefined();
      expect(user.profile.id).toBe(testData.profileId);
      expect(user.profile.bio).toBe("Test user profile bio");
    });

    it("should handle filtered one-to-one relations with DataLoader", async () => {
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            profile(where: { bio: { like: "%profile%" } }) {
              id
              bio
            }
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      const user = (data?.userFindMany as any[])[0];
      expect(user.profile).toBeDefined();
      expect(user.profile.bio).toContain("profile");
    });
  });

  describe("DataLoader Export Tool Integration", () => {
    it("should work with export directive and DataLoader optimization", async () => {
      const data = await executeQueryWithExport(
        `
        query GetUserPosts($authorId: ID = "") {
          user: userFindFirst(where: { email: { eq: "${testData.testEmail}" } }) {
            id @export(as: "authorId")
            name
            email
          }
          posts: postFindMany(where: { authorId: { eq: $authorId } }) {
            id
            title
            authorId
            comments {
              id
              text
              user {
                id
                name
              }
            }
          }
        }
        `,
        { authorId: "$_authorId" }
      );

      expect(data?.user).toBeDefined();
      expect((data?.user as any).id).toBe(testData.userId);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      const posts = data?.posts as any[];
      if (posts.length > 0) {
        expect(posts[0].authorId).toBe(testData.userId);
        expect(posts[0]).toHaveProperty("comments");
        expect(Array.isArray(posts[0].comments)).toBe(true);
      }
    });

    it("should handle complex nested exports with DataLoader", async () => {
      const cityId = generateUlid();
      const sportId = generateUlid();
      const postId1 = generateUlid();
      const uniqueSlug = `test-city-${generateUlid().slice(-8)}`;
      const uniqueSportName = `Test Football ${generateUlid().slice(-8)}`;

      // Insert test data
      await db.insert(city).values({
        id: cityId,
        name: "Test City",
        slug: uniqueSlug,
      });

      await db.insert(sport).values({
        id: sportId,
        name: uniqueSportName,
      });

      await db.insert(post).values({
        id: postId1,
        title: "Football Game",
        content: "Great football game",
        authorId: testData.userId,
        sportId: sportId,
        cityId: cityId,
      });

      const query = `
        query testSportWithPosts($citySlug: String!, $sportName: String!, $cityId: ID = "") {
          cityFindFirst(where: { slug: { eq: $citySlug } }) {
            id @export(as: "cityId")
            name
            slug
          }
          sportWithPosts: sportFindFirst(where: { name: { eq: $sportName } }) {
            id
            name
            posts(where: { cityId: { eq: $cityId } }) {
              id
              title
              content
              cityId
              sportId
              author {
                id
                name
              }
              comments {
                id
                text
                user {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const data = await executeQueryWithExport(query, {
        citySlug: uniqueSlug,
        sportName: uniqueSportName,
        cityId: "$_cityId",
      });

      expect(data?.cityFindFirst).toBeDefined();
      expect(data?.cityFindFirst?.id).toBe(cityId);
      expect(data?.sportWithPosts).toBeDefined();
      expect(data?.sportWithPosts?.id).toBe(sportId);
      expect(data?.sportWithPosts?.posts).toBeDefined();
      expect(Array.isArray(data?.sportWithPosts?.posts)).toBe(true);

      // Cleanup
      await db.delete(post).where(eq(post.id, postId1));
      await db.delete(sport).where(eq(sport.id, sportId));
      await db.delete(city).where(eq(city.id, cityId));
    });
  });

  describe("DataLoader Performance Comparison", () => {
    it("should demonstrate DataLoader efficiency with multiple users and posts", async () => {
      // Create multiple users and posts for performance testing
      const userIds: string[] = [];
      const postIds: string[] = [];

      // Create 5 test users
      for (let i = 0; i < 5; i++) {
        const userId = generateUlid();
        userIds.push(userId);

        await db.insert(user).values({
          id: userId,
          name: `Performance User ${i}`,
          email: `perf${i}@example.com`,
        });

        // Create 2 posts per user
        for (let j = 0; j < 2; j++) {
          const postId = generateUlid();
          postIds.push(postId);

          await db.insert(post).values({
            id: postId,
            title: `Post ${j} by User ${i}`,
            content: `Content for post ${j}`,
            authorId: userId,
          });
        }
      }

      // Query all users with their posts - this should be efficient with DataLoader
      const startTime = Date.now();

      const data = await executeQuery(`
        query {
          userFindMany(where: { email: { like: "perf%" } }) {
            id
            name
            email
            posts {
              id
              title
              content
              author {
                id
                name
              }
            }
          }
        }
      `);

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      console.log(`DataLoader query completed in ${queryTime}ms`);

      expect(data?.userFindMany as any[]).toHaveLength(5);

      const users = data?.userFindMany as any[];
      users.forEach((user: any) => {
        expect(user.posts).toBeDefined();
        expect(Array.isArray(user.posts)).toBe(true);
        expect(user.posts.length).toBe(2);

        user.posts.forEach((post: any) => {
          expect(post.author).toBeDefined();
          expect(post.author.id).toBe(user.id);
        });
      });

      // Cleanup
      for (const postId of postIds) {
        await db.delete(post).where(eq(post.id, postId));
      }
      for (const userId of userIds) {
        await db.delete(user).where(eq(user.id, userId));
      }
    });
  });

  describe("DataLoader FindFirst Tests", () => {
    it("should use DataLoader for findFirst with relations", async () => {
      const data = await executeQuery(
        `
        query($userId: ID!) {
          userFindFirst(where: { id: { eq: $userId } }) {
            id
            name
            posts {
              id
              title
              comments {
                id
                text
                user {
                  id
                  name
                }
              }
            }
            profile {
              id
              bio
            }
          }
        }
        `,
        { userId: testData.userId }
      );

      expect(data?.userFindFirst).toBeDefined();
      const user = data?.userFindFirst as any;
      expect(user.id).toBe(testData.userId);
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.profile).toBeDefined();
    });
  });

  describe("DataLoader Type Safety Tests", () => {
    it("should have correct resolver structure with DataLoader", () => {
      expect(resolvers).toHaveProperty("Query");
      expect(resolvers).toHaveProperty("Mutation");
      expect(resolvers.Query).toHaveProperty("userFindMany");
      expect(resolvers.Query).toHaveProperty("postFindMany");
      expect(resolvers.Query).toHaveProperty("commentFindMany");
      expect(resolvers.Query).toHaveProperty("reactionFindMany");
      expect(resolvers.Mutation).toHaveProperty("userInsertMany");
      expect(resolvers.Mutation).toHaveProperty("userUpdateMany");
      expect(resolvers.Mutation).toHaveProperty("userDeleteMany");
    });
  });
});
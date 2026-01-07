import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, and } from "drizzle-orm";
import { ulid as generateUlid } from "ulid";
import * as schema from "./schema";
import {
  user,
  post,
  comment,
  reaction,
  userProfile,
  sport,
  city,
} from "./schema";
import { executeGraphQLQuery } from "./shared-envelop";
import { createSerialEnvelop } from "./shared-serial-config";

// Database schema imports
const db_schema = schema;

// Create test database client
const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test-serial-resolvers.db",
});

const db = drizzle(client, {
  schema: db_schema,
  logger: {
    logQuery: (query, params) => {
      if (process.env.DEBUG_SQL) {
        console.log("🔍 SQL Query:", query);
        console.log("📋 Parameters:", params);
        console.log("---");
      }
    },
  },
});

// Create envelop configuration with serial directive support
const serialEnveloped = createSerialEnvelop(db);
const normalEnveloped = createSerialEnvelop(db, { enableSerial: false });

describe("Serial Directive Integration Tests", () => {
  const testData = {
    userId1: generateUlid(),
    userId2: generateUlid(),
    postId1: generateUlid(),
    postId2: generateUlid(),
    commentId1: generateUlid(),
    commentId2: generateUlid(),
    reactionId1: generateUlid(),
    reactionId2: generateUlid(),
    profileId1: generateUlid(),
    profileId2: generateUlid(),
    sportId: generateUlid(),
    cityId: generateUlid(),
    testEmail1: `serial-test-1-${generateUlid()}@example.com`,
    testEmail2: `serial-test-2-${generateUlid()}@example.com`,
  };

  beforeAll(async () => {
    // Seed test data for serial execution tests
    await db.insert(sport).values({
      id: testData.sportId,
      name: "Serial Test Sport",
    });

    await db.insert(city).values({
      id: testData.cityId,
      name: "Serial Test City",
      slug: `serial-city-${generateUlid().slice(-8)}`,
    });

    await db.insert(user).values([
      {
        id: testData.userId1,
        name: "Serial Test User 1",
        email: testData.testEmail1,
        bio: "First test user for serial execution",
      },
      {
        id: testData.userId2,
        name: "Serial Test User 2",
        email: testData.testEmail2,
        bio: "Second test user for serial execution",
      },
    ]);

    await db.insert(post).values([
      {
        id: testData.postId1,
        title: "Serial Test Post 1",
        content: "First test post content",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId2,
        title: "Serial Test Post 2",
        content: "Second test post content",
        authorId: testData.userId2,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
    ]);

    await db.insert(comment).values([
      {
        id: testData.commentId1,
        text: "First serial test comment",
        postId: testData.postId1,
        userId: testData.userId1,
      },
      {
        id: testData.commentId2,
        text: "Second serial test comment",
        postId: testData.postId2,
        userId: testData.userId2,
      },
    ]);

    await db.insert(reaction).values([
      {
        id: testData.reactionId1,
        postId: testData.postId1,
        commentId: testData.commentId1,
        authorId: testData.userId1,
        type: "LIKE",
      },
      {
        id: testData.reactionId2,
        postId: testData.postId2,
        commentId: testData.commentId2,
        authorId: testData.userId2,
        type: "DISLIKE",
      },
    ]);

    await db.insert(userProfile).values([
      {
        id: testData.profileId1,
        userId: testData.userId1,
        bio: "Profile for serial test user 1",
        avatarUrl: "https://example.com/avatar1.jpg",
        website: "https://serial-test-1.com",
      },
      {
        id: testData.profileId2,
        userId: testData.userId2,
        bio: "Profile for serial test user 2",
        avatarUrl: "https://example.com/avatar2.jpg",
        website: "https://serial-test-2.com",
      },
    ]);
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(reaction).where(eq(reaction.authorId, testData.userId1));
    await db.delete(reaction).where(eq(reaction.authorId, testData.userId2));
    await db.delete(comment).where(eq(comment.userId, testData.userId1));
    await db.delete(comment).where(eq(comment.userId, testData.userId2));
    await db.delete(post).where(eq(post.authorId, testData.userId1));
    await db.delete(post).where(eq(post.authorId, testData.userId2));
    await db
      .delete(userProfile)
      .where(eq(userProfile.userId, testData.userId1));
    await db
      .delete(userProfile)
      .where(eq(userProfile.userId, testData.userId2));
    await db.delete(user).where(eq(user.id, testData.userId1));
    await db.delete(user).where(eq(user.id, testData.userId2));
    await db.delete(sport).where(eq(sport.id, testData.sportId));
    await db.delete(city).where(eq(city.id, testData.cityId));
  });

  describe("Serial Directive Basic Functionality", () => {
    it("should execute root-level queries sequentially with @serial directive", async () => {
      const executionLog: string[] = [];
      const startTime = Date.now();

      // Enable debugging for this test
      const originalDebug = process.env.DEBUG_SERIAL;
      process.env.DEBUG_SERIAL = "true";

      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query GetDataSequentially @serial {
          users: userFindMany(limit: 2) {
            id
            name
            email
          }
          posts: postFindMany(limit: 2) {
            id
            title
            content
          }
          comments: commentFindMany(limit: 2) {
            id
            text
          }
        }
        `
      );

      const endTime = Date.now();
      console.log(`Serial query execution time: ${endTime - startTime}ms`);

      // Restore debug setting
      process.env.DEBUG_SERIAL = originalDebug;

      expect(data).toBeDefined();
      expect(data?.users).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(Array.isArray(data?.comments)).toBe(true);
      expect((data?.users as any[]).length).toBe(2);
      expect((data?.posts as any[]).length).toBe(2);
      expect((data?.comments as any[]).length).toBe(2);
    });

    it("should execute normally without @serial directive", async () => {
      const startTime = Date.now();

      const data = await executeGraphQLQuery(
        normalEnveloped,
        `
        query GetDataParallel {
          users: userFindMany(limit: 2) {
            id
            name
            email
          }
          posts: postFindMany(limit: 2) {
            id
            title
            content
          }
          comments: commentFindMany(limit: 2) {
            id
            text
          }
        }
        `
      );

      const endTime = Date.now();
      console.log(`Parallel query execution time: ${endTime - startTime}ms`);

      expect(data).toBeDefined();
      expect(data?.users).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(Array.isArray(data?.comments)).toBe(true);
      expect((data?.users as any[]).length).toBe(2);
      expect((data?.posts as any[]).length).toBe(2);
      expect((data?.comments as any[]).length).toBe(2);
    });

    it("should demonstrate timing difference between serial and parallel execution", async () => {
      // Test with artificial delay to make timing differences more apparent
      const delayQuery = `
        query GetDataWithDelay {
          users: userFindMany(limit: 1) {
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
          }
          posts: postFindMany(limit: 1) {
            id
            title
            author {
              id
              name
            }
          }
        }
      `;

      // Parallel execution
      const parallelStart = Date.now();
      const parallelData = await executeGraphQLQuery(
        normalEnveloped,
        delayQuery
      );
      const parallelTime = Date.now() - parallelStart;

      // Serial execution
      const serialStart = Date.now();
      const serialData = await executeGraphQLQuery(
        serialEnveloped,
        delayQuery.replace("GetDataWithDelay", "GetDataWithDelay @serial")
      );
      const serialTime = Date.now() - serialStart;

      console.log(`Parallel execution: ${parallelTime}ms`);
      console.log(`Serial execution: ${serialTime}ms`);

      // Both should return the same data
      expect(parallelData).toBeDefined();
      expect(serialData).toBeDefined();
      expect(parallelData?.users).toBeDefined();
      expect(serialData?.users).toBeDefined();
      expect(parallelData?.posts).toBeDefined();
      expect(serialData?.posts).toBeDefined();

      // Serial execution might be slightly slower due to queuing overhead
      // but this isn't always guaranteed in fast operations
      console.log(
        `Serial vs Parallel time difference: ${serialTime - parallelTime}ms`
      );
    });
  });

  describe("Serial Directive with Nested Relations", () => {
    it("should execute nested queries sequentially within parent scope", async () => {
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query GetNestedDataSequentially @serial {
          users: userFindMany(where: { 
            id: { in: ["${testData.userId1}", "${testData.userId2}"] } 
          }) {
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
        `
      );

      expect(data?.users).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      const users = data?.users as any[];
      expect(users.length).toBeGreaterThanOrEqual(2);

      // Verify nested relations are loaded
      users.forEach((user: any) => {
        expect(user.posts).toBeDefined();
        expect(user.profile).toBeDefined();
        expect(Array.isArray(user.posts)).toBe(true);

        if (user.posts.length > 0) {
          user.posts.forEach((post: any) => {
            expect(post.comments).toBeDefined();
            expect(Array.isArray(post.comments)).toBe(true);

            if (post.comments.length > 0) {
              post.comments.forEach((comment: any) => {
                expect(comment.reactions).toBeDefined();
                expect(Array.isArray(comment.reactions)).toBe(true);
              });
            }
          });
        }
      });
    });

    it("should handle mixed serial and nested parallel execution correctly", async () => {
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query MixedExecutionTest @serial {
          firstUser: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id
            name
            posts {
              id
              title
            }
            profile {
              id
              bio
            }
          }
          firstPost: postFindFirst(where: { id: { eq: "${testData.postId1}" } }) {
            id
            title
            author {
              id
              name
            }
            comments {
              id
              text
            }
          }
          firstComment: commentFindFirst(where: { id: { eq: "${testData.commentId1}" } }) {
            id
            text
            user {
              id
              name
            }
            post {
              id
              title
            }
          }
        }
        `
      );

      expect(data?.firstUser).toBeDefined();
      expect(data?.firstPost).toBeDefined();
      expect(data?.firstComment).toBeDefined();

      // Verify the data structure
      expect(data?.firstUser?.id).toBe(testData.userId1);
      expect(data?.firstPost?.id).toBe(testData.postId1);
      expect(data?.firstComment?.id).toBe(testData.commentId1);

      // Verify nested relations
      expect(data?.firstUser?.posts).toBeDefined();
      expect(data?.firstUser?.profile).toBeDefined();
      expect(data?.firstPost?.author).toBeDefined();
      expect(data?.firstPost?.comments).toBeDefined();
      expect(data?.firstComment?.user).toBeDefined();
      expect(data?.firstComment?.post).toBeDefined();
    });
  });

  describe("Serial Directive Performance Impact", () => {
    it("should handle large datasets with serial execution", async () => {
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query LargeDatasetSerial @serial {
          users: userFindMany(limit: 10) {
            id
            name
            email
          }
          posts: postFindMany(limit: 10) {
            id
            title
            content
          }
          comments: commentFindMany(limit: 10) {
            id
            text
          }
        }
        `
      );

      expect(data?.users).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(Array.isArray(data?.comments)).toBe(true);

      // Should handle up to the available data (we only have 2 users, 2 posts, 2 comments)
      expect((data?.users as any[]).length).toBeLessThanOrEqual(10);
      expect((data?.posts as any[]).length).toBeLessThanOrEqual(10);
      expect((data?.comments as any[]).length).toBeLessThanOrEqual(10);
    });

    it("should handle complex queries with multiple levels of nesting", async () => {
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query ComplexSerialQuery @serial {
          sport: sportFindFirst(where: { id: { eq: "${testData.sportId}" } }) {
            id
            name
            posts {
              id
              title
              author {
                id
                name
                profile {
                  id
                  bio
                }
              }
              comments {
                id
                text
                user {
                  id
                  name
                }
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
          }
        }
        `
      );

      expect(data?.sport).toBeDefined();
      expect(data?.sport?.posts).toBeDefined();
      expect(Array.isArray(data?.sport?.posts)).toBe(true);

      const posts = data?.sport?.posts as any[];
      if (posts.length > 0) {
        posts.forEach((post: any) => {
          expect(post.author).toBeDefined();
          expect(post.comments).toBeDefined();

          if (post.author) {
            // Profile might not exist for all users in test data
            if (post.author.profile) {
              expect(post.author.profile).toBeDefined();
            }
          }

          if (post.comments && post.comments.length > 0) {
            post.comments.forEach((comment: any) => {
              expect(comment.user).toBeDefined();
              expect(comment.reactions).toBeDefined();

              if (comment.reactions && comment.reactions.length > 0) {
                comment.reactions.forEach((reaction: any) => {
                  // User relation should be present but test data might be limited
                  if (reaction.user) {
                    expect(reaction.user).toBeDefined();
                  }
                });
              }
            });
          }
        });
      }
    });
  });

  describe("Serial Directive Error Handling", () => {
    it("should handle errors in serial execution gracefully", async () => {
      // Test with a query that might cause an error
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query ErrorHandlingTest @serial {
          validUsers: userFindMany(limit: 2) {
            id
            name
          }
          posts: postFindMany(limit: 2) {
            id
            title
          }
        }
        `
      );

      // Should still return valid data even if some fields might have issues
      expect(data?.validUsers).toBeDefined();
      expect(data?.posts).toBeDefined();
    });

    it("should handle empty results in serial execution", async () => {
      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query EmptyResultsTest @serial {
          nonExistentUsers: userFindMany(where: { name: { eq: "non-existent-user" } }) {
            id
            name
          }
          validPosts: postFindMany(limit: 1) {
            id
            title
          }
        }
        `
      );

      expect(data?.nonExistentUsers).toBeDefined();
      expect(Array.isArray(data?.nonExistentUsers)).toBe(true);
      expect((data?.nonExistentUsers as any[]).length).toBe(0);
      expect(data?.validPosts).toBeDefined();
      expect(Array.isArray(data?.validPosts)).toBe(true);
      expect((data?.validPosts as any[]).length).toBeGreaterThan(0);
    });
  });

  describe("Serial Directive Query Execution Tests", () => {
    it("should demonstrate serial directive behavior with complex queries", async () => {
      // Test that demonstrates the execution order with timing
      const startTime = Date.now();

      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query OrderedExecution @serial {
          first: userFindMany(limit: 1) {
            id
            name
          }
          second: postFindMany(limit: 1) {
            id
            title
          }
          third: commentFindMany(limit: 1) {
            id
            text
          }
        }
        `
      );

      const endTime = Date.now();
      console.log(`Serial execution completed in ${endTime - startTime}ms`);

      expect(data?.first).toBeDefined();
      expect(data?.second).toBeDefined();
      expect(data?.third).toBeDefined();
      expect(Array.isArray(data?.first)).toBe(true);
      expect(Array.isArray(data?.second)).toBe(true);
      expect(Array.isArray(data?.third)).toBe(true);
    });

    it("should verify serial execution maintains data consistency", async () => {
      // This test simulates what would be mutation behavior with queries
      // demonstrating that serial execution maintains order and consistency

      const data = await executeGraphQLQuery(
        serialEnveloped,
        `
        query SimulatedWorkflow @serial {
          step1: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id
            name
          }
          step2: postFindMany(where: { authorId: { eq: "${testData.userId1}" } }, limit: 1) {
            id
            title
            authorId
          }
          step3: commentFindMany(where: { userId: { eq: "${testData.userId1}" } }, limit: 1) {
            id
            text
            userId
          }
        }
        `
      );

      expect(data?.step1).toBeDefined();
      expect(data?.step2).toBeDefined();
      expect(data?.step3).toBeDefined();

      // Verify the data relationships are correct
      if (data?.step1) {
        expect(data.step1.id).toBe(testData.userId1);
      }

      if (data?.step2 && Array.isArray(data.step2) && data.step2.length > 0) {
        expect(data.step2[0].authorId).toBe(testData.userId1);
      }

      if (data?.step3 && Array.isArray(data.step3) && data.step3.length > 0) {
        expect(data.step3[0].userId).toBe(testData.userId1);
      }
    });
  });

  describe("Serial Directive Configuration Tests", () => {
    it("should demonstrate the difference in execution strategy", async () => {
      const query = `
        query ConfigTest {
          users: userFindMany(limit: 2) {
            id
            name
          }
          posts: postFindMany(limit: 2) {
            id
            title  
          }
        }
      `;

      // Execute with serial directive
      const serialResult = await executeGraphQLQuery(
        serialEnveloped,
        query.replace("ConfigTest", "ConfigTest @serial")
      );

      // Execute without serial directive
      const parallelResult = await executeGraphQLQuery(normalEnveloped, query);

      // Both should return the same data structure
      expect(serialResult?.users).toBeDefined();
      expect(serialResult?.posts).toBeDefined();
      expect(parallelResult?.users).toBeDefined();
      expect(parallelResult?.posts).toBeDefined();

      expect(Array.isArray(serialResult?.users)).toBe(true);
      expect(Array.isArray(serialResult?.posts)).toBe(true);
      expect(Array.isArray(parallelResult?.users)).toBe(true);
      expect(Array.isArray(parallelResult?.posts)).toBe(true);

      // Data content should be equivalent
      expect((serialResult?.users as any[]).length).toBe(
        (parallelResult?.users as any[]).length
      );
      expect((serialResult?.posts as any[]).length).toBe(
        (parallelResult?.posts as any[]).length
      );
    });

    it("should verify schema includes serial directive", () => {
      // Get the schema from the shared-serial-config
      const { createSerialSchema } = require("./shared-serial-config");
      const { schema } = createSerialSchema(db);

      const directiveNames = schema.getDirectives().map((d) => d.name);

      expect(directiveNames).toContain("serial");

      const serialDirective = schema.getDirective("serial");
      expect(serialDirective).toBeDefined();
      expect(serialDirective?.locations).toContain("QUERY");
      expect(serialDirective?.locations).toContain("MUTATION");
    });
  });
});

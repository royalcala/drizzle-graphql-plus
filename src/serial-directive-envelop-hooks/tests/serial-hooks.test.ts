import { describe, it, expect, beforeEach } from "vitest";
import { reset } from "drizzle-seed";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { ulid as generateUlid } from "ulid";
import * as schema from "../../build-schema-sdl-with-dl/tests/schema";
import {
  user,
  post,
  comment,
  reaction,
  userProfile,
  sport,
  city,
} from "../../build-schema-sdl-with-dl/tests/schema";
import { envelop, useEngine, useSchema, useExtendContext } from "@envelop/core";
import { execute as graphqlExecute, subscribe, parse } from "graphql";
import { useDataLoaderCleanup } from "../../build-schema-sdl-with-dl/generator/utils/envelop-plugin";
import {
  buildSchemaSDL,
  makeExecutableSchema,
  commonScalars,
} from "../../build-schema-sdl-with-dl";
import { useSerialDirective, serialDirectiveTypeDefs } from "../index";
import { GraphQLULID } from "graphql-scalars";
import { makeScalarAcceptExports } from "../../export-directive[DEPRECATED]";

// Database schema imports
const db_schema = schema;

// Create test database client
const client = createClient({
  url: "file:src/serial-directive-envelop-hooks/tests/test-serial-hooks.db",
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

// Setup flexible ID scalar with export support
GraphQLULID.name = "ID";
const FlexibleID = makeScalarAcceptExports(GraphQLULID);

/**
 * Create Envelop instance with serial directive support
 */
function createSerialEnvelop(enableSerial: boolean = true) {
  const { typeDefs, resolvers } = buildSchemaSDL(db);

  const directiveTypeDefs = [
    ...(enableSerial ? [serialDirectiveTypeDefs] : []),
    `enum ReactionType { LIKE DISLIKE }`,
  ];

  const fullTypeDefs = [...directiveTypeDefs, typeDefs].join("\n\n");

  const schema = makeExecutableSchema({
    typeDefs: fullTypeDefs,
    resolvers: {
      ...resolvers,
      ...commonScalars,
      ID: FlexibleID,
    },
  });

  return envelop({
    plugins: [
      useEngine({ execute: graphqlExecute, subscribe, parse }),
      useSchema(schema),
      useDataLoaderCleanup({ db }),
      useExtendContext(() => ({ db })),
      ...(enableSerial ? [useSerialDirective()] : []),
    ],
  });
}

// Create envelop configurations
const serialEnveloped = createSerialEnvelop(true);
const normalEnveloped = createSerialEnvelop(false);

/**
 * Execute a GraphQL query using Envelop
 */
async function executeGraphQLQuery(
  enveloped: ReturnType<typeof envelop>,
  query: string,
  variables?: Record<string, any>
): Promise<any> {
  const { execute, schema, contextFactory } = enveloped();

  const document = parse(query);
  const context = await contextFactory();

  const result = await execute({
    schema,
    document,
    contextValue: context,
    variableValues: variables,
  });

  if ("data" in result) {
    return result.data;
  }

  throw new Error(`GraphQL execution failed: ${JSON.stringify(result)}`);
}

describe("Serial Envelop Hooks Tests", () => {
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
    testEmail1: `serial-hooks-test-1-${generateUlid()}@example.com`,
    testEmail2: `serial-hooks-test-2-${generateUlid()}@example.com`,
  };

  beforeEach(async () => {
    // Reset database
    await reset(db, schema);
    // Seed test data
    await db.insert(sport).values({
      id: testData.sportId,
      name: "Serial Hooks Test Sport",
    });

    await db.insert(city).values({
      id: testData.cityId,
      name: "Serial Hooks Test City",
      slug: `serial-hooks-city-${generateUlid().slice(-8)}`,
    });

    await db.insert(user).values([
      {
        id: testData.userId1,
        name: "Serial Hooks User 1",
        email: testData.testEmail1,
        bio: "First test user for serial hooks",
      },
      {
        id: testData.userId2,
        name: "Serial Hooks User 2",
        email: testData.testEmail2,
        bio: "Second test user for serial hooks",
      },
    ]);

    await db.insert(post).values([
      {
        id: testData.postId1,
        title: "Serial Hooks Post 1",
        content: "First test post content",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId2,
        title: "Serial Hooks Post 2",
        content: "Second test post content",
        authorId: testData.userId2,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
    ]);

    await db.insert(comment).values([
      {
        id: testData.commentId1,
        text: "First serial hooks comment",
        postId: testData.postId1,
        userId: testData.userId1,
      },
      {
        id: testData.commentId2,
        text: "Second serial hooks comment",
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
        bio: "Profile for serial hooks user 1",
        avatarUrl: "https://example.com/avatar1.jpg",
        website: "https://serial-hooks-1.com",
      },
      {
        id: testData.profileId2,
        userId: testData.userId2,
        bio: "Profile for serial hooks user 2",
        avatarUrl: "https://example.com/avatar2.jpg",
        website: "https://serial-hooks-2.com",
      },
    ]);
  });



  describe("Basic Serial Directive Functionality", () => {
    it("should execute root-level queries sequentially with @serial directive", async () => {
      const startTime = Date.now();

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
      const query = `
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
      const parallelData = await executeGraphQLQuery(normalEnveloped, query);
      const parallelTime = Date.now() - parallelStart;

      // Serial execution
      const serialStart = Date.now();
      const serialData = await executeGraphQLQuery(
        serialEnveloped,
        query.replace("GetDataWithDelay", "GetDataWithDelay @serial")
      );
      const serialTime = Date.now() - serialStart;

      console.log(`Parallel execution: ${parallelTime}ms`);
      console.log(`Serial execution: ${serialTime}ms`);
      console.log(
        `Serial vs Parallel time difference: ${serialTime - parallelTime}ms`
      );

      // Both should return the same data
      expect(parallelData).toBeDefined();
      expect(serialData).toBeDefined();
      expect(parallelData?.users).toBeDefined();
      expect(serialData?.users).toBeDefined();
      expect(parallelData?.posts).toBeDefined();
      expect(serialData?.posts).toBeDefined();
    });
  });

  describe("Serial Directive with Nested Relations", () => {
    it("should execute nested queries correctly", async () => {
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

    it("should handle mixed serial root fields and nested parallel execution", async () => {
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

  describe("Serial Directive Error Handling", () => {
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

  describe("Serial Directive Query Execution Order", () => {
    it("should demonstrate serial directive behavior with ordered execution", async () => {
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

  describe("Serial vs Parallel Comparison", () => {
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
  });
});

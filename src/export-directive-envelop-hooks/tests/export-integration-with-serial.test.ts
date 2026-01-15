import { describe, it, expect, beforeEach } from "vitest";
import { reset } from "drizzle-seed";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { ulid as generateUlid } from "ulid";
import { ensureMigratedSqliteTestDb } from "../../build-schema-sdl-with-dl/tests/test-db-utils";
import * as schema from "../../build-schema-sdl-with-dl/tests/schema";
import {
  user,
  post,
  comment,
  city,
  sport,
  reaction,
} from "../../build-schema-sdl-with-dl/tests/schema";
import { envelop, useEngine, useSchema, useExtendContext } from "@envelop/core";
import { execute as graphqlExecute, subscribe, parse } from "graphql";
import { useDataLoaderCleanup } from "../../build-schema-sdl-with-dl/generator/utils/envelop-plugin";
import {
  buildSchemaSDL,
  makeExecutableSchema,
  commonScalars,
} from "../../build-schema-sdl-with-dl";
import { useExportDirective, exportDirectiveTypeDefs } from "../index";
import {
  useSerialDirective,
  serialDirectiveTypeDefs,
} from "../../serial-directive-envelop-hooks";
import { GraphQLULID } from "graphql-scalars";
import { makeScalarAcceptExports } from "../index";

// Database schema imports
const db_schema = schema;

// Create test database client
const client = createClient({
  url: "file:src/export-directive-envelop-hooks/tests/test-export-integration.db",
});

const db = drizzle(client, {
  schema: db_schema,
  logger: true, // Enabled for debugging
});

// Setup flexible ID scalar with export support
GraphQLULID.name = "ID";
const FlexibleID = makeScalarAcceptExports(GraphQLULID);

/**
 * Create Envelop instance with both export and serial directive support
 */
function createIntegrationEnvelop() {
  const { typeDefs, resolvers } = buildSchemaSDL(db);

  const directiveTypeDefs = [
    exportDirectiveTypeDefs,
    serialDirectiveTypeDefs,
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
      useSerialDirective(), // Add serial directive first
      useExportDirective(), // Then export directive
    ],
  });
}

// Create envelop configuration
const integrationEnveloped = createIntegrationEnvelop();

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

describe("Export + Serial Integration Tests", () => {
  const testData = {
    userId1: generateUlid(),
    userId2: generateUlid(),
    userId3: generateUlid(),
    userId4: generateUlid(),
    postId1: generateUlid(),
    postId2: generateUlid(),
    postId3: generateUlid(),
    postId4: generateUlid(),
    commentId1: generateUlid(),
    commentId2: generateUlid(),
    commentId3: generateUlid(),
    sportId: generateUlid(),
    cityId: generateUlid(),
    testEmail1: `integration-1-${generateUlid()}@example.com`,
    testEmail2: `integration-2-${generateUlid()}@example.com`,
    testEmail3: `integration-3-${generateUlid()}@example.com`,
    testEmail4: `export-serial-test-4-${generateUlid()}@example.com`,
  };

  beforeEach(async () => {
    // Reset database
    await reset(db, schema);

    // Seed test data
    // Ensure schema exists for this test DB via drizzle-kit.
    await db.insert(sport).values({
      id: testData.sportId,
      name: "Integration Test Sport",
    });

    await db.insert(city).values({
      id: testData.cityId,
      name: "Integration Test City",
      slug: `integration-city-${generateUlid().slice(-8)}`,
    });

    await db.insert(user).values([
      {
        id: testData.userId1,
        name: "Integration User 1",
        email: testData.testEmail1,
        bio: "First integration user",
      },
      {
        id: testData.userId2,
        name: "Integration User 2",
        email: testData.testEmail2,
        bio: "Second integration user",
      },
      {
        id: testData.userId3,
        name: "Integration User 3",
        email: testData.testEmail3,
        bio: "Third integration user",
      },
      {
        id: testData.userId4,
        name: "Integration User 4",
        email: testData.testEmail4,
        bio: "Fourth integration user",
      },
    ]);

    await db.insert(post).values([
      {
        id: testData.postId1,
        title: "Integration Post 1",
        content: "First integration post",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId2,
        title: "Integration Post 2",
        content: "Second integration post",
        authorId: testData.userId2,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId3,
        title: "Integration Post 3",
        content: "Third integration post",
        authorId: testData.userId3,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId4,
        title: "Integration Post 4",
        content: "Fourth integration post",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
    ]);

    await db.insert(comment).values([
      {
        id: testData.commentId1,
        text: "First integration comment",
        postId: testData.postId1,
        userId: testData.userId1,
      },
      {
        id: testData.commentId2,
        text: "Second integration comment",
        postId: testData.postId2,
        userId: testData.userId2,
      },
      {
        id: testData.commentId3,
        text: "Third integration comment",
        postId: testData.postId3,
        userId: testData.userId3,
      },
    ]);
  });



  describe("Serial + Export Working Together", () => {
    it("should execute exports sequentially with @serial directive", async () => {
      const startTime = Date.now();

      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_userId: ID = "", $_authorIds: [ID!] = [""]) @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
          }
          posts: postFindMany(where: { authorId: { eq: $_userId } }) {
            id
            title
            authorId @export(as: "$_authorIds")
          }
          comments: commentFindMany(where: { userId: { in: $_authorIds } }) {
            id
            text
          }
        }
        `
      );

      const endTime = Date.now();
      console.log(`Serial + Export execution time: ${endTime - startTime}ms`);

      expect(data?.user).toBeDefined();
      expect(data?.user?.id).toBe(testData.userId1);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.comments)).toBe(true);
    });

    it("should accumulate array values correctly with serial execution", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_userIds: [ID!] = [""]) @serial {
          users: userFindMany(limit: 4) {
            id @export(as: "$_userIds")
            name
          }
          posts: postFindMany(where: { authorId: { in: $_userIds } }) {
            id
            title
            authorId
          }
        }
        `
      );

      expect(data?.users).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      const users = data?.users as any[];
      const posts = data?.posts as any[];

      // Verify accumulation worked - all posts should have authorIds from users
      const userIds = users.map((u: any) => u.id);
      expect(userIds.length).toBe(4);

      posts.forEach((post: any) => {
        expect(userIds).toContain(post.authorId);
      });
    });

    it("should handle complex multi-step export chains with serial", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query (
          $_userId: ID = "",
          $_postIds: [ID!] = [""],
          $_commentIds: [ID!] = [""]
        ) @serial {
          # Step 1: Find user
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
          }
          
          # Step 2: Get user's posts
          posts: postFindMany(where: { authorId: { eq: $_userId } }) {
            id @export(as: "$_postIds")
            title
          }
          
          # Step 3: Get comments on those posts
          comments: commentFindMany(where: { postId: { in: $_postIds } }) {
            id @export(as: "$_commentIds")
            text
            postId 
          }
        }
        `
      );

      expect(data?.user).toBeDefined();
      expect(data?.user?.id).toBe(testData.userId1);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.comments)).toBe(true);

      const posts = data?.posts as any[];
      const comments = data?.comments as any[];

      // Verify the chain worked
      expect(posts.length).toBeGreaterThan(0);

      // All comments should be for posts that belong to userId1
      const postIds = posts.map((p: any) => p.id);
      comments.forEach((comment: any) => {
        expect(postIds).toContain(comment.postId);
      });
    });
  });

  describe("Accumulation Order with Serial", () => {
    it("should accumulate in the correct order with serial execution", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_authorIds: [ID!] = [""]) @serial {
          users: userFindMany(limit: 4) {
            id @export(as: "$_authorIds")
            name
          }
          posts: postFindMany(where: { authorId: { in: $_authorIds } }) {
            id
            title
            authorId
          }
        }
        `
      );
      // if (!data?.users) console.log("Missing users data:", JSON.stringify(data, null, 2));

      expect(data?.users).toBeDefined();
      const users = data?.users as any[];
      expect(users.length).toBe(4);

      expect(data?.posts).toBeDefined();
      const posts = data?.posts as any[];

      // All posts should have authorIds that were exported
      const userIds = users.map((u: any) => u.id);
      posts.forEach((post: any) => {
        expect(userIds).toContain(post.authorId);
      });
    });

    it("should handle nested accumulation with serial", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_postIds: [ID!] = [""]) @serial {
          users: userFindMany(limit: 3) {
            name
            posts {
              id @export(as: "$_postIds")
              title
            }
          }
          comments: commentFindMany(where: { postId: { in: $_postIds } }) {
            id
            text
            postId
          }
        }
        `
      );

      expect(data?.users).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.comments)).toBe(true);

      const users = data?.users as any[];
      const comments = data?.comments as any[];

      // Collect all post IDs from all users
      const allPostIds: string[] = [];
      users.forEach((user: any) => {
        if (user.posts && Array.isArray(user.posts)) {
          user.posts.forEach((post: any) => {
            allPostIds.push(post.id);
          });
        }
      });

      // All comments should be for posts that were exported
      comments.forEach((comment: any) => {
        expect(allPostIds).toContain(comment.postId);
      });
    });
  });

  describe("Performance with Serial + Export", () => {
    it("should demonstrate sequential execution timing", async () => {
      const startTime = Date.now();

      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_userId: ID = "", $_postIds: [ID!] = [""]) @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
          }
          posts: postFindMany(where: { authorId: { eq: $_userId } }) {
            id @export(as: "$_postIds")
            title
          }
          comments: commentFindMany(where: { postId: { in: $_postIds } }) {
            id
            text
          }
        }
        `
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      console.log(`Serial + Export chain execution time: ${executionTime}ms`);

      expect(data?.user).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(data?.comments).toBeDefined();

      // Serial execution should take longer than parallel but ensure correctness
      expect(executionTime).toBeGreaterThan(0);
    });
  });

  describe("Sport posts with city user aggregation", () => {
    it("should accumulate multiple userIds from posts/comments and reuse in userFindMany", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
                query (
                    $_cityId: ID = "",
                    $_sportId: ID = "",
                    $_usersIds: [ID!] = [""]
                ) @serial {
                    city: cityFindFirst(where: { id: { eq: "${testData.cityId}" } }) {
                        id @export(as: "$_cityId")
                        name
                    }

                    sport: sportFindFirst(where: { id: { eq: "${testData.sportId}" } }) {
                        id @export(as: "$_sportId")
                        name
                    }

                    posts: postFindMany(
                        limit: 15,
                        where: { cityId: { eq: $_cityId }, sportId: { eq: $_sportId } }
                    ) {
                        id
                        authorId @export(as: "$_usersIds")
                        comments {
                            id
                            authorId @export(as: "$_usersIds")
                        }
                    }

                    users: userFindMany(where: { id: { inArray: $_usersIds } }) {
                        id
                        name
                    }
                }
                `
      );

      expect(data?.city).toBeDefined();
      expect(data?.sport).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);
      expect(data?.users).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);

      const usersResult = data?.users as any[];
      const userIds = usersResult.map((u: any) => u.id).sort();
      const expectedIds = [
        testData.userId1,
        testData.userId2,
        testData.userId3,
      ].sort();

      expect(userIds).toEqual(expectedIds);
    });
  });



  describe("Reproduction: Deep Nested Exports with findFirst", () => {
    it("should export variables from nested collections in findFirst", async () => {
      // Setup specific data for this reproduction to ensure unique IDs
      const reproData = {
        postId: generateUlid(),
        postAuthorId: generateUlid(),
        commentId: generateUlid(),
        commentAuthorId: generateUlid(),
        postReactionId: generateUlid(),
        postReactionAuthorId: generateUlid(),
        commentReactionId: generateUlid(),
        commentReactionAuthorId: generateUlid(),
      };

      // Insert data
      await db.insert(user).values([
        { id: reproData.postAuthorId, name: "Post Author", email: `post-author-${reproData.postAuthorId}@test.com` },
        { id: reproData.commentAuthorId, name: "Comment Author", email: `comment-author-${reproData.commentAuthorId}@test.com` },
        { id: reproData.postReactionAuthorId, name: "Post Reaction Author", email: `nr-author-${reproData.postReactionAuthorId}@test.com` },
        { id: reproData.commentReactionAuthorId, name: "Comment Reaction Author", email: `cr-author-${reproData.commentReactionAuthorId}@test.com` },
      ]);

      await db.insert(post).values({
        id: reproData.postId,
        title: "Repro Post",
        content: "Content",
        authorId: reproData.postAuthorId,
      });

      await db.insert(comment).values({
        id: reproData.commentId,
        text: "Repro Comment",
        postId: reproData.postId,
        userId: reproData.commentAuthorId,
      });

      await db.insert(reaction).values([
        {
          id: reproData.postReactionId,
          postId: reproData.postId,
          authorId: reproData.postReactionAuthorId,
          type: "LIKE",
        },
        {
          id: reproData.commentReactionId,
          postId: reproData.postId,
          commentId: reproData.commentId,
          authorId: reproData.commentReactionAuthorId,
          type: "LIKE",
        },
      ]);

      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query postById($postId: ID!, $_usersIds: [ID!]) @serial {
          postFindFirst(where: { id: { eq: $postId } }) {
            authorId @export(as: "$_usersIds")
            reactions {
              authorId @export(as: "$_usersIds")
              id
            }
            comments {
              userId @export(as: "$_usersIds")
              reactions {
                authorId @export(as: "$_usersIds")
                id
              }
              id
            }
            id
          }
    
          userFindMany(where: { id: { inArray: $_usersIds } }) {
            id
          }
        }
        `,
        {
          postId: reproData.postId,
        }
      );



      expect(data?.postFindFirst).toBeDefined();
      expect(data?.userFindMany).toBeDefined();

      const foundUsers = data?.userFindMany as any[];
      const foundIds = foundUsers.map(u => u.id).sort();
      const expectedIds = [
        reproData.postAuthorId,
        reproData.commentAuthorId,
        reproData.postReactionAuthorId,
        reproData.commentReactionAuthorId
      ].sort();

      expect(foundIds).toEqual(expectedIds);
    });
  });
  describe("Error Handling with Serial + Export", () => {
    it("should handle errors gracefully in serial + export chain", async () => {
      const data = await executeGraphQLQuery(
        integrationEnveloped,
        `
        query ($_userId: ID = "") @serial {
          user: userFindFirst(where: { email: { eq: "nonexistent@example.com" } }) {
            id @export(as: "$_userId")
            name
          }
          posts: postFindMany(where: { authorId: { eq: $_userId } }, limit: 10) {
            id
            title
          }
        }
        `
      );

      // User should be null
      expect(data?.user).toBeNull();

      // Posts query should still execute but with empty/default userId
      expect(data?.posts).toBeDefined();
    });
  });
});


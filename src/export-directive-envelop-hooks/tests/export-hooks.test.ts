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
  city,
  sport,
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
  url: "file:src/export-directive-envelop-hooks/tests/test-export-hooks.db",
});

const db = drizzle(client, {
  schema: db_schema,
  logger: true,
});

// Setup flexible ID scalar with export support
GraphQLULID.name = "ID";
const FlexibleID = makeScalarAcceptExports(GraphQLULID);

/**
 * Create Envelop instance with export directive support
 * Includes serial directive for predictable execution order
 */
function createExportEnvelop() {
  const { typeDefs, resolvers } = buildSchemaSDL(db);

  const directiveTypeDefs = [
    exportDirectiveTypeDefs,
    serialDirectiveTypeDefs, // Add serial for predictable execution
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
const exportEnveloped = createExportEnvelop();

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

  if ("errors" in result && result.errors) {
    console.error("GraphQL Errors:", JSON.stringify(result.errors, null, 2));
  }

  if ("data" in result) {
    return result.data;
  }

  throw new Error(`GraphQL execution failed: ${JSON.stringify(result)}`);
}

describe("Export Directive Envelop Hooks Tests", () => {
  const testData = {
    userId1: generateUlid(),
    userId2: generateUlid(),
    userId3: generateUlid(),
    postId1: generateUlid(),
    postId2: generateUlid(),
    postId3: generateUlid(),
    commentId1: generateUlid(),
    commentId2: generateUlid(),
    sportId: generateUlid(),
    cityId: generateUlid(),
    testEmail1: `export-test-1-${generateUlid()}@example.com`,
    testEmail2: `export-test-2-${generateUlid()}@example.com`,
    testEmail3: `export-test-3-${generateUlid()}@example.com`,
  };

  beforeEach(async () => {
    // Reset database
    await reset(db, schema);
    // Seed test data
    await db.insert(sport).values({
      id: testData.sportId,
      name: "Export Test Sport",
    });

    await db.insert(city).values({
      id: testData.cityId,
      name: "Export Test City",
      slug: `export-city-${generateUlid().slice(-8)}`,
    });

    await db.insert(user).values([
      {
        id: testData.userId1,
        name: "Export User 1",
        email: testData.testEmail1,
        bio: "First test user for exports",
      },
      {
        id: testData.userId2,
        name: "Export User 2",
        email: testData.testEmail2,
        bio: "Second test user for exports",
      },
      {
        id: testData.userId3,
        name: "Export User 3",
        email: testData.testEmail3,
        bio: "Third test user for exports",
      },
    ]);

    await db.insert(post).values([
      {
        id: testData.postId1,
        title: "Export Post 1",
        content: "First test post",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId2,
        title: "Export Post 2",
        content: "Second test post",
        authorId: testData.userId2,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
      {
        id: testData.postId3,
        title: "Export Post 3",
        content: "Third test post",
        authorId: testData.userId1,
        sportId: testData.sportId,
        cityId: testData.cityId,
      },
    ]);

    await db.insert(comment).values([
      {
        id: testData.commentId1,
        text: "First export comment",
        postId: testData.postId1,
        userId: testData.userId1,
      },
      {
        id: testData.commentId2,
        text: "Second export comment",
        postId: testData.postId2,
        userId: testData.userId2,
      },
    ]);
  });



  describe("Basic Export/Import Functionality", () => {
    it("should export and import a single value", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_userId: ID = "") @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
          }
          posts: postFindMany(where: { authorId: { eq: $_userId } }) {
            id
            title
          }
        }
        `
      );

      expect(data?.user).toBeDefined();
      expect(data?.user?.id).toBe(testData.userId1);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      // Should find posts by the exported userId
      const posts = data?.posts as any[""];
      expect(posts.length).toBeGreaterThan(0);
      posts.forEach((post: any) => {
        // All posts should be from userId1 since we exported that ID
        expect(post.id).toBeDefined();
      });
    });

    it("should handle export with nested field access", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_cityId: ID = "") @serial {
          city: cityFindFirst(where: { id: { eq: "${testData.cityId}" } }) {
            id @export(as: "$_cityId")
            name
          }
          posts: postFindMany(where: { cityId: { eq: $_cityId } }) {
            id
            title
            city {
              name
            }
          }
        }
        `
      );

      expect(data?.city).toBeDefined();
      expect(data?.city?.id).toBe(testData.cityId);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      const posts = data?.posts as any[""];
      expect(posts.length).toBeGreaterThan(0);
      posts.forEach((post: any) => {
        expect(post.city?.name).toBe("Export Test City");
      });
    });
  });

  describe("Array Accumulation", () => {
    it("should accumulate values from array items", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_authorIds: [ID!] = [""]) @serial {
          users: userFindMany(limit: 3) {
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

      expect(data?.users).toBeDefined();
      expect(Array.isArray(data?.users)).toBe(true);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      const users = data?.users as any[""];
      const posts = data?.posts as any[""];

      // All posts should have authorIds that are in the users array
      const userIds = users.map((u: any) => u.id);
      posts.forEach((post: any) => {
        expect(userIds).toContain(post.authorId);
      });
    });
  });

  describe("Nested Exports", () => {
    it("should export values from nested fields", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_postIds: [ID!] = [""]) @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
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

      expect(data?.user).toBeDefined();
      expect(data?.user?.posts).toBeDefined();
      expect(Array.isArray(data?.user?.posts)).toBe(true);
      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.comments)).toBe(true);

      const posts = data?.user?.posts as any[""];
      const comments = data?.comments as any[""];

      console.log("Debug Nested Exports:");
      console.log("User Posts:", JSON.stringify(posts, null, 2));
      console.log("Comments:", JSON.stringify(comments, null, 2));

      // All comments should have postIds that are in the user's posts
      const postIds = posts.map((p: any) => p.id);
      comments.forEach((comment: any) => {
        expect(postIds).toContain(comment.postId);
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle empty results", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_userId: ID = "") @serial {
          user: userFindFirst(where: { email: { eq: "nonexistent@example.com" } }) {
            id @export(as: "$_userId")
            name
          }
        }
        `
      );

      expect(data?.user).toBeNull();
    });
  });

  describe("Multiple Exports", () => {
    it("should handle multiple exports in the same query", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_userId: ID = "", $_cityId: ID = "") @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
          }
          city: cityFindFirst(where: { id: { eq: "${testData.cityId}" } }) {
            id @export(as: "$_cityId")
            name
          }
          posts: postFindMany(where: { 
            AND: [
              { authorId: { eq: $_userId } },
              { cityId: { eq: $_cityId } }
            ]
          }) {
            id
            title
          }
        }
        `
      );

      expect(data?.user).toBeDefined();
      expect(data?.city).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);

      const posts = data?.posts as any[""];
      expect(posts.length).toBeGreaterThan(0);
    });
  });

  describe("Advanced Filters", () => {
    it("should support exports inside OR filters", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query (
          $_userId: ID = "",
          $_postIds: [ID!] = [""]
        ) @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
            posts {
              id @export(as: "$_postIds")
              title
            }
          }
          comments: commentFindMany(where: {
            OR: [
              { postId: { in: $_postIds } },
              { userId: { eq: $_userId } }
            ]
          }) {
            id
            text
            postId
            userId
          }
        }
        `
      );

      expect(data?.user).toBeDefined();
      expect(data?.comments).toBeDefined();
      const comments = data?.comments as any[""];
      expect(Array.isArray(comments)).toBe(true);
      expect(comments.length).toBeGreaterThan(0);

      const userId = data?.user?.id;
      const postIds = (data?.user?.posts as any[""]).map((p: any) => p.id);

      comments.forEach((comment: any) => {
        const matchesPost = postIds.includes(comment.postId);
        const matchesUser = comment.userId === userId;
        expect(matchesPost || matchesUser).toBe(true);
      });
    });

    it("should export and reuse non-ID scalar values", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query ($_slug: String = "") @serial {
          byId: cityFindFirst(where: { id: { eq: "${testData.cityId}" } }) {
            id
            name
            slug @export(as: "$_slug")
          }
          bySlug: cityFindFirst(where: { slug: { eq: $_slug } }) {
            id
            name
            slug
          }
        }
        `
      );

      expect(data?.byId).toBeDefined();
      expect(data?.bySlug).toBeDefined();
      expect(data?.byId?.id).toBe(testData.cityId);
      expect(data?.bySlug?.id).toBe(testData.cityId);
      expect(data?.bySlug?.slug).toBe(data?.byId?.slug);
    });

    it("should handle nested OR/AND filters with exports", async () => {
      const data = await executeGraphQLQuery(
        exportEnveloped,
        `
        query (
          $_userId: ID = "",
          $_postIds: [ID!] = [""]
        ) @serial {
          user: userFindFirst(where: { id: { eq: "${testData.userId1}" } }) {
            id @export(as: "$_userId")
            name
            posts {
              id @export(as: "$_postIds")
              title
            }
          }
          comments: commentFindMany(where: {
            OR: [
              { postId: { in: $_postIds } },
              { OR: [
                  { postId: { eq: "${testData.postId2}" } },
                  { userId: { eq: $_userId } }
                ]
              }
            ]
          }) {
            id
            text
            postId
            userId
          }
        }
        `
      );

      expect(data?.user).toBeDefined();
      expect(data?.comments).toBeDefined();
      const comments = data?.comments as any[""];
      expect(Array.isArray(comments)).toBe(true);
      // We expect to match comment on postId1 via the first OR branch
      // and comment on postId2 via the nested OR branch.
      const commentIds = comments.map((c: any) => c.id).sort();
      const expectedIds = [testData.commentId1, testData.commentId2].sort();
      expect(commentIds).toEqual(expectedIds);
    });
  });
});

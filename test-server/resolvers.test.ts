import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL } from "../src/index";
import * as schema from "./schema";
import { user, post, comment, reaction } from "./schema";
import { ulid as generateUlid } from "ulid";
import { graphql, GraphQLSchema } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLULID } from "graphql-scalars";
import { eq } from "drizzle-orm";

// Create test database client
const client = createClient({
  url: "file:test-server/test-resolvers.db",
});

const db = drizzle(client, { schema });

// Build GraphQL schema
const { typeDefs, resolvers } = buildSchemaSDL(db);

// Create executable schema
const customTypeDefinitions = `scalar ULID\nenum ReactionType { LIKE DISLIKE }`;
const extendedTypeDefs = customTypeDefinitions + "\n" + typeDefs;

const customScalarResolvers = { ULID: GraphQLULID };
const resolversWithScalars = { ...resolvers, ...customScalarResolvers };
const executableSchema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: resolversWithScalars,
});

// Helper to execute GraphQL queries
async function executeQuery(query: string, variables?: Record<string, any>) {
  const result = await graphql({
    schema: executableSchema,
    source: query,
    variableValues: variables,
  });
  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  return result.data;
}

describe("Resolver Tests", () => {
  const testData = {
    userId: generateUlid(),
    postId: generateUlid(),
    commentId: generateUlid(),
    reactionId: generateUlid(),
  };

  beforeAll(async () => {
    // Seed test data
    await db.insert(user).values({
      id: testData.userId,
      name: "Test User",
      email: "test@example.com",
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
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(reaction);
    await db.delete(comment);
    await db.delete(post);
    await db.delete(user);
  });

  describe("Query Resolvers", () => {
    it("should query users", async () => {
      const data = await executeQuery(`
        query {
          user {
            id
            name
            email
            bio
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.user).toBeDefined();
      expect(Array.isArray(data?.user)).toBe(true);
      expect((data?.user as any[]).length).toBeGreaterThan(0);
      expect((data?.user as any[])[0]).toHaveProperty("id");
      expect((data?.user as any[])[0]).toHaveProperty("name");
    });

    it("should query users with where filter", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          user(where: { id: { eq: $userId } }) {
            id
            name
            email
          }
        }
      `,
        { userId: testData.userId }
      );

      expect(data?.user as any[]).toHaveLength(1);
      expect((data?.user as any[])[0].id).toBe(testData.userId);
      expect((data?.user as any[])[0].name).toBe("Test User");
    });

    it("should query posts", async () => {
      const data = await executeQuery(`
        query {
          post {
            id
            title
            content
            authorId
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.post).toBeDefined();
      expect(Array.isArray(data?.post)).toBe(true);
    });

    it("should query posts with where filter", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          post(where: { id: { eq: $postId } }) {
            id
            title
            authorId
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.post as any[]).toHaveLength(1);
      expect((data?.post as any[])[0].id).toBe(testData.postId);
      expect((data?.post as any[])[0].title).toBe("Test Post");
    });

    it("should query with limit and offset", async () => {
      const data = await executeQuery(`
        query {
          user(limit: 1, offset: 0) {
            id
            name
          }
        }
      `);

      expect(((data?.user as any[]) || []).length).toBeLessThanOrEqual(1);
    });
  });

  describe("Mutation Resolvers - Insert", () => {
    it("should insert a new user", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          insertUser(values: $values) {
            id
            name
            email
          }
        }
      `,
        {
          values: [
            {
              name: "New User",
              email: "newuser@example.com",
            },
          ],
        }
      );
      expect(data?.insertUser as any[]).toHaveLength(1);
      expect((data?.insertUser as any[])[0].name).toBe("New User");
      expect((data?.insertUser as any[])[0]).toHaveProperty("id");
      // Cleanup
      const insertedId = (data?.insertUser as any[])[0].id;
      //correct way to use drizzle
      await db.delete(user).where(eq(user.id, insertedId));
      //incorrect way to use drizzle
      //   await db.delete(user).where((t) => t.id.eq(insertedId));
    });

    it("should insert multiple users", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          insertUser(values: $values) {
            id
            name
          }
        }
      `,
        {
          values: [
            { name: "User 1", email: "user1@example.com" },
            { name: "User 2", email: "user2@example.com" },
          ],
        }
      );

      expect(data?.insertUser as any[]).toHaveLength(2);
      expect((data?.insertUser as any[])[0]).toHaveProperty("id");
      expect((data?.insertUser as any[])[1]).toHaveProperty("id");
      expect((data?.insertUser as any[])[0].name).toBe("User 1");
      expect((data?.insertUser as any[])[1].name).toBe("User 2");

      // Cleanup
      const userId1 = (data?.insertUser as any[])[0].id;
      const userId2 = (data?.insertUser as any[])[1].id;
      await db.delete(user).where(eq(user.id, userId1));
      await db.delete(user).where(eq(user.id, userId2));
    });

    it("should insert user with custom id", async () => {
      const customId = generateUlid();
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          insertUser(values: $values) {
            id
            name
            email
          }
        }
      `,
        {
          values: [
            {
              id: customId,
              name: "Custom ID User",
              email: "customid@example.com",
            },
          ],
        }
      );

      expect(data?.insertUser as any[]).toHaveLength(1);
      expect((data?.insertUser as any[])[0].id).toBe(customId);
      expect((data?.insertUser as any[])[0].name).toBe("Custom ID User");

      // Cleanup
      await db.delete(user).where(eq(user.id, customId));
    });

    it("should insert user without id (auto-generated)", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          insertUser(values: $values) {
            id
            name
            email
          }
        }
      `,
        {
          values: [
            {
              name: "Auto ID User",
              email: "autoid@example.com",
            },
          ],
        }
      );

      expect(data?.insertUser as any[]).toHaveLength(1);
      expect((data?.insertUser as any[])[0]).toHaveProperty("id");
      expect((data?.insertUser as any[])[0].id).toBeTruthy();
      expect((data?.insertUser as any[])[0].name).toBe("Auto ID User");

      // Cleanup
      const autoId = (data?.insertUser as any[])[0].id;
      await db.delete(user).where(eq(user.id, autoId));
    });
  });

  describe("Mutation Resolvers - Update", () => {
    it("should update a user", async () => {
      const data = await executeQuery(
        `
        mutation($set: UserUpdateInput!, $where: UserFilters) {
          updateUser(set: $set, where: $where) {
            id
            name
          }
        }
      `,
        {
          set: { name: "Updated Name" },
          where: { id: { eq: testData.userId } },
        }
      );

      expect(data?.updateUser as any[]).toHaveLength(1);
      expect((data?.updateUser as any[])[0].id).toBe(testData.userId);
      expect((data?.updateUser as any[])[0].name).toBe("Updated Name");

      // Restore original data
      await db
        .update(user)
        .set({ name: "Test User" })
        .where(eq(user.id, testData.userId));
    });

    it("should update a post", async () => {
      const data = await executeQuery(
        `
        mutation($set: PostUpdateInput!, $where: PostFilters) {
          updatePost(set: $set, where: $where) {
            id
            title
          }
        }
      `,
        {
          set: { title: "Updated Title" },
          where: { id: { eq: testData.postId } },
        }
      );

      expect(data?.updatePost as any[]).toHaveLength(1);
      expect((data?.updatePost as any[])[0].title).toBe("Updated Title");

      // Restore
      await db
        .update(post)
        .set({ title: "Test Post" })
        .where(eq(post.id, testData.postId));
    });
  });

  describe("Mutation Resolvers - Delete", () => {
    it("should delete a user", async () => {
      // Create a user to delete
      const deleteUserId = generateUlid();
      await db.insert(user).values({
        id: deleteUserId,
        name: "To Delete",
        email: "delete@example.com",
      });

      const data = await executeQuery(
        `
        mutation($where: UserFilters!) {
          deleteUser(where: $where) {
            id
            name
          }
        }
      `,
        { where: { id: { eq: deleteUserId } } }
      );

      expect(data?.deleteUser as any[]).toHaveLength(1);
      expect((data?.deleteUser as any[])[0].id).toBe(deleteUserId);

      // Verify deletion
      const checkData = await executeQuery(
        `
        query($userId: ULID!) {
          user(where: { id: { eq: $userId } }) {
            id
          }
        }
      `,
        { userId: deleteUserId }
      );
      expect(checkData?.user as any[]).toHaveLength(0);
    });
  });

  describe("Type Safety Tests", () => {
    it("should have correct resolver structure", () => {
      expect(resolvers).toHaveProperty("Query");
      expect(resolvers).toHaveProperty("Mutation");
      expect(resolvers.Query).toHaveProperty("user");
      expect(resolvers.Query).toHaveProperty("post");
      expect(resolvers.Query).toHaveProperty("comment");
      expect(resolvers.Query).toHaveProperty("reaction");
      expect(resolvers.Mutation).toHaveProperty("insertUser");
      expect(resolvers.Mutation).toHaveProperty("updateUser");
      expect(resolvers.Mutation).toHaveProperty("deleteUser");
    });
  });
});

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

    it("should query users with where filter", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
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

    it("should query posts", async () => {
      const data = await executeQuery(`
        query {
          postFindMany {
            id
            title
            content
            authorId
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.postFindMany).toBeDefined();
      expect(Array.isArray(data?.postFindMany)).toBe(true);
    });

    it("should query posts with where filter", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            authorId
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindMany as any[]).toHaveLength(1);
      expect((data?.postFindMany as any[])[0].id).toBe(testData.postId);
      expect((data?.postFindMany as any[])[0].title).toBe("Test Post");
    });

    it("should query with limit and offset", async () => {
      const data = await executeQuery(`
        query {
          userFindMany(limit: 1, offset: 0) {
            id
            name
          }
        }
      `);

      expect(((data?.userFindMany as any[]) || []).length).toBeLessThanOrEqual(
        1
      );
    });
  });

  describe("Mutation Resolvers - Insert", () => {
    it("should insert a new user", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          userInsertMany(values: $values) {
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
      expect(data?.userInsertMany as any[]).toHaveLength(1);
      expect((data?.userInsertMany as any[])[0].name).toBe("New User");
      expect((data?.userInsertMany as any[])[0]).toHaveProperty("id");
      // Cleanup
      const insertedId = (data?.userInsertMany as any[])[0].id;
      //correct way to use drizzle
      await db.delete(user).where(eq(user.id, insertedId));
      //incorrect way to use drizzle
      //   await db.delete(user).where((t) => t.id.eq(insertedId));
    });

    it("should insert multiple users", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          userInsertMany(values: $values) {
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

      expect(data?.userInsertMany as any[]).toHaveLength(2);
      expect((data?.userInsertMany as any[])[0]).toHaveProperty("id");
      expect((data?.userInsertMany as any[])[1]).toHaveProperty("id");
      expect((data?.userInsertMany as any[])[0].name).toBe("User 1");
      expect((data?.userInsertMany as any[])[1].name).toBe("User 2");

      // Cleanup
      const userId1 = (data?.userInsertMany as any[])[0].id;
      const userId2 = (data?.userInsertMany as any[])[1].id;
      await db.delete(user).where(eq(user.id, userId1));
      await db.delete(user).where(eq(user.id, userId2));
    });

    it("should insert user with custom id", async () => {
      const customId = generateUlid();
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          userInsertMany(values: $values) {
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

      expect(data?.userInsertMany as any[]).toHaveLength(1);
      expect((data?.userInsertMany as any[])[0].id).toBe(customId);
      expect((data?.userInsertMany as any[])[0].name).toBe("Custom ID User");

      // Cleanup
      await db.delete(user).where(eq(user.id, customId));
    });

    it("should insert user without id (auto-generated)", async () => {
      const data = await executeQuery(
        `
        mutation($values: [UserInsertInput!]!) {
          userInsertMany(values: $values) {
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

      expect(data?.userInsertMany as any[]).toHaveLength(1);
      expect((data?.userInsertMany as any[])[0]).toHaveProperty("id");
      expect((data?.userInsertMany as any[])[0].id).toBeTruthy();
      expect((data?.userInsertMany as any[])[0].name).toBe("Auto ID User");

      // Cleanup
      const autoId = (data?.userInsertMany as any[])[0].id;
      await db.delete(user).where(eq(user.id, autoId));
    });
  });

  describe("Mutation Resolvers - Update", () => {
    it("should update a user", async () => {
      const data = await executeQuery(
        `
        mutation($set: UserUpdateInput!, $where: UserFilters) {
          userUpdateMany(set: $set, where: $where) {
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

      expect(data?.userUpdateMany as any[]).toHaveLength(1);
      expect((data?.userUpdateMany as any[])[0].id).toBe(testData.userId);
      expect((data?.userUpdateMany as any[])[0].name).toBe("Updated Name");

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
          postUpdateMany(set: $set, where: $where) {
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

      expect(data?.postUpdateMany as any[]).toHaveLength(1);
      expect((data?.postUpdateMany as any[])[0].title).toBe("Updated Title");

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
          userDeleteMany(where: $where) {
            id
            name
          }
        }
      `,
        { where: { id: { eq: deleteUserId } } }
      );

      expect(data?.userDeleteMany as any[]).toHaveLength(1);
      expect((data?.userDeleteMany as any[])[0].id).toBe(deleteUserId);

      // Verify deletion
      const checkData = await executeQuery(
        `
        query($userId: ULID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
          }
        }
      `,
        { userId: deleteUserId }
      );
      expect(checkData?.userFindMany as any[]).toHaveLength(0);
    });
  });

  describe("Type Safety Tests", () => {
    it("should have correct resolver structure", () => {
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

  describe("Deep Relational Queries", () => {
    it("should query users with nested posts and comments", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindMany(where: { id: { eq: $userId } }) {
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
              }
            }
          }
        }
      `,
        { userId: testData.userId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      const user = (data?.userFindMany as any[])[0];
      expect(user.id).toBe(testData.userId);
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBeGreaterThan(0);

      const userPost = user.posts[0];
      expect(userPost.id).toBe(testData.postId);
      expect(userPost.comments).toBeDefined();
      expect(Array.isArray(userPost.comments)).toBe(true);
      expect(userPost.comments.length).toBeGreaterThan(0);

      const postComment = userPost.comments[0];
      expect(postComment.id).toBe(testData.commentId);
      expect(postComment.text).toBe("Test comment");
    });

    it("should insert post with relations and query nested data", async () => {
      const newUserId = generateUlid();

      // First create a user
      await db.insert(user).values({
        id: newUserId,
        name: "Relational Test User",
        email: "relational@example.com",
      });

      // Insert post using mutation with nested query
      const data = await executeQuery(
        `
        mutation($values: [PostInsertInput!]!) {
          postInsertMany(values: $values) {
            id
            title
            content
            author {
              id
              name
              email
            }
          }
        }
      `,
        {
          values: [
            {
              title: "Relational Test Post",
              content: "Testing deep relations",
              authorId: newUserId,
            },
          ],
        }
      );

      expect(data?.postInsertMany as any[]).toHaveLength(1);
      const insertedPost = (data?.postInsertMany as any[])[0];
      expect(insertedPost.title).toBe("Relational Test Post");
      expect(insertedPost.author).toBeDefined();
      expect(insertedPost.author.id).toBe(newUserId);
      expect(insertedPost.author.name).toBe("Relational Test User");
      expect(insertedPost.author.email).toBe("relational@example.com");

      // Cleanup
      await db.delete(post).where(eq(post.id, insertedPost.id));
      await db.delete(user).where(eq(user.id, newUserId));
    });

    it("should update post and query with nested relations", async () => {
      const data = await executeQuery(
        `
        mutation($set: PostUpdateInput!, $where: PostFilters) {
          postUpdateMany(set: $set, where: $where) {
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
      `,
        {
          set: { content: "Updated content with relations" },
          where: { id: { eq: testData.postId } },
        }
      );

      expect(data?.postUpdateMany as any[]).toHaveLength(1);
      const updatedPost = (data?.postUpdateMany as any[])[0];
      expect(updatedPost.content).toBe("Updated content with relations");
      expect(updatedPost.author).toBeDefined();
      expect(updatedPost.author.id).toBe(testData.userId);
      expect(updatedPost.comments).toBeDefined();
      expect(Array.isArray(updatedPost.comments)).toBe(true);
      expect(updatedPost.comments.length).toBeGreaterThan(0);
      expect(updatedPost.comments[0].user).toBeDefined();
      expect(updatedPost.comments[0].user.id).toBe(testData.userId);

      // Restore
      await db
        .update(post)
        .set({ content: "Test content" })
        .where(eq(post.id, testData.postId));
    });

    it("should insert multiple comments and query with nested user data", async () => {
      const data = await executeQuery(
        `
        mutation($values: [CommentInsertInput!]!) {
          commentInsertMany(values: $values) {
            id
            text
            post {
              id
              title
              author {
                id
                name
              }
            }
            user {
              id
              name
              email
            }
          }
        }
      `,
        {
          values: [
            {
              text: "First deep comment",
              postId: testData.postId,
              userId: testData.userId,
            },
            {
              text: "Second deep comment",
              postId: testData.postId,
              userId: testData.userId,
            },
          ],
        }
      );

      expect(data?.commentInsertMany as any[]).toHaveLength(2);
      const comments = data?.commentInsertMany as any[];

      // Find comments by text since order is not guaranteed
      const firstComment = comments.find(
        (c: any) => c.text === "First deep comment"
      );
      const secondComment = comments.find(
        (c: any) => c.text === "Second deep comment"
      );

      expect(firstComment).toBeDefined();
      expect(firstComment.text).toBe("First deep comment");
      expect(firstComment.post).toBeDefined();
      expect(firstComment.post.id).toBe(testData.postId);
      expect(firstComment.post.author).toBeDefined();
      expect(firstComment.post.author.id).toBe(testData.userId);
      expect(firstComment.user).toBeDefined();
      expect(firstComment.user.id).toBe(testData.userId);

      expect(secondComment).toBeDefined();
      expect(secondComment.text).toBe("Second deep comment");
      expect(secondComment.post).toBeDefined();
      expect(secondComment.user).toBeDefined();

      // Cleanup
      await db.delete(comment).where(eq(comment.id, firstComment.id));
      await db.delete(comment).where(eq(comment.id, secondComment.id));
    });
  });
});

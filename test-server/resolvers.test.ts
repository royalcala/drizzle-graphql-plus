import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { buildSchemaSDL } from "../src/index";
import * as schema from "./schema";
import { user, post, comment, reaction, userProfile } from "./schema";
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
} from "../src/export-tool";

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
let executableSchema = makeExecutableSchema({
  typeDefs: extendedTypeDefs,
  resolvers: resolversWithScalars,
});

// Create FlexibleULID using the new factory function
const FlexibleULID = makeScalarAcceptExports(GraphQLULID);

// Wrap resolvers with export middleware AND add FlexibleULID scalar
const composedResolvers = composeResolvers(
  {
    ...resolvers,
    ULID: FlexibleULID,
  },
  {
    "*.*": [createExportMiddleware()],
  }
);
let executableSchemaWithExport = makeExecutableSchema({
  typeDefs: extendedTypeDefs + "\ndirective @export(as: String!) on FIELD",
  resolvers: composedResolvers,
});

// Helper to execute GraphQL queries
async function executeQuery(query: string, variables?: Record<string, any>) {
  const result = await graphql({
    schema: executableSchema,
    source: query,
    variableValues: variables,
    contextValue: {}, // Provide empty context object (ExportStore will be initialized by transformer)
  });
  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  return result.data;
}

// Helper to execute GraphQL queries with export-tool enabled
async function executeQueryWithExport(
  query: string,
  variables?: Record<string, any>,
  context?: any
) {
  const result = await graphql({
    schema: executableSchemaWithExport,
    source: query,
    variableValues: variables,
    contextValue: context || {}, // Use provided context or create new one
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

  describe("Query Resolvers", () => {
    it("should query users", async () => {
      const data = await executeQuery(`
        query {
          userFindMany {
            id
            name
            email
            bio
            _operation
          }
        }
      `);

      expect(data).toBeDefined();
      expect(data?.userFindMany).toBeDefined();
      expect(Array.isArray(data?.userFindMany)).toBe(true);
      expect((data?.userFindMany as any[]).length).toBeGreaterThan(0);
      expect((data?.userFindMany as any[])[0]).toHaveProperty("id");
      expect((data?.userFindMany as any[])[0]).toHaveProperty("name");
      expect((data?.userFindMany as any[])[0]._operation).toBe("READ");
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
            _operation
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
      expect((data?.userInsertMany as any[])[0]._operation).toBe("INSERTED");
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
      const users = data?.userInsertMany as any[];

      // Find users by name since order is not guaranteed
      const user1 = users.find((u: any) => u.name === "User 1");
      const user2 = users.find((u: any) => u.name === "User 2");

      expect(user1).toBeDefined();
      expect(user1).toHaveProperty("id");
      expect(user2).toBeDefined();
      expect(user2).toHaveProperty("id");

      // Cleanup
      await db.delete(user).where(eq(user.id, user1.id));
      await db.delete(user).where(eq(user.id, user2.id));
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
            _operation
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
      expect((data?.userUpdateMany as any[])[0]._operation).toBe("UPDATED");

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
            email
            _operation
          }
        }
      `,
        { where: { id: { eq: deleteUserId } } }
      );

      expect(data?.userDeleteMany as any[]).toHaveLength(1);
      expect((data?.userDeleteMany as any[])[0].id).toBe(deleteUserId);
      expect((data?.userDeleteMany as any[])[0].name).toBe("To Delete");
      expect((data?.userDeleteMany as any[])[0]._operation).toBe("DELETED");

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

    it("should delete multiple posts and return deleted data", async () => {
      // Create a user and posts for deletion
      const deleteUserId = generateUlid();
      const deletePostId1 = generateUlid();
      const deletePostId2 = generateUlid();

      await db.insert(user).values({
        id: deleteUserId,
        name: "Delete Test User",
        email: "deletetest@example.com",
      });

      await db.insert(post).values([
        {
          id: deletePostId1,
          title: "Post 1 to Delete",
          content: "First post to delete",
          authorId: deleteUserId,
        },
        {
          id: deletePostId2,
          title: "Post 2 to Delete",
          content: "Second post to delete",
          authorId: deleteUserId,
        },
      ]);

      // Delete posts
      const data = await executeQuery(
        `
        mutation($where: PostFilters!) {
          postDeleteMany(where: $where) {
            id
            title
            content
            _operation
          }
        }
      `,
        { where: { authorId: { eq: deleteUserId } } }
      );

      expect(data?.postDeleteMany as any[]).toHaveLength(2);
      const deletedPosts = data?.postDeleteMany as any[];
      const deletedIds = deletedPosts.map((p: any) => p.id);
      expect(deletedIds).toContain(deletePostId1);
      expect(deletedIds).toContain(deletePostId2);
      expect(deletedPosts[0]._operation).toBe("DELETED");
      expect(deletedPosts[0]).toHaveProperty("title");
      expect(deletedPosts[0]).toHaveProperty("content");

      // Verify deletion
      const checkData = await executeQuery(
        `
        query($postId: ULID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
          }
        }
      `,
        { postId: deletePostId1 }
      );
      expect(checkData?.postFindMany as any[]).toHaveLength(0);

      // Cleanup user
      await db.delete(user).where(eq(user.id, deleteUserId));
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

  describe("One-to-One Relation Tests", () => {
    it("should query user with profile (one-to-one)", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
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
      expect(user.profile.avatarUrl).toBe("https://example.com/avatar.jpg");
      expect(user.profile.website).toBe("https://example.com");
    });

    it("should query profile with user (inverse one-to-one)", async () => {
      const data = await executeQuery(
        `
        query($profileId: ULID!) {
          userProfileFindMany(where: { id: { eq: $profileId } }) {
            id
            bio
            user {
              id
              name
              email
            }
          }
        }
      `,
        { profileId: testData.profileId }
      );

      expect(data?.userProfileFindMany as any[]).toHaveLength(1);
      const profile = (data?.userProfileFindMany as any[])[0];
      expect(profile.id).toBe(testData.profileId);
      expect(profile.user).toBeDefined();
      expect(profile.user.id).toBe(testData.userId);
      expect(profile.user.name).toBe("Test User");
    });

    it("should query user with filtered profile that matches", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
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

    it("should return null for profile when filter does not match (one-to-one)", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            profile(where: { bio: { eq: "Non-existent bio" } }) {
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
      expect(user.profile).toBeNull();
    });

    it("should insert user with profile and query nested", async () => {
      const newUserId = generateUlid();
      const newProfileId = generateUlid();

      // Insert user
      await db.insert(user).values({
        id: newUserId,
        name: "User with Profile",
        email: "withprofile@example.com",
      });

      // Insert profile
      await db.insert(userProfile).values({
        id: newProfileId,
        userId: newUserId,
        bio: "New user profile",
        avatarUrl: "https://example.com/new.jpg",
      });

      // Query with nested relation
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            profile {
              id
              bio
              avatarUrl
            }
          }
        }
      `,
        { userId: newUserId }
      );

      expect(data?.userFindMany as any[]).toHaveLength(1);
      const queriedUser = (data?.userFindMany as any[])[0];
      expect(queriedUser.profile).toBeDefined();
      expect(queriedUser.profile.id).toBe(newProfileId);
      expect(queriedUser.profile.bio).toBe("New user profile");

      // Cleanup
      await db.delete(userProfile).where(eq(userProfile.id, newProfileId));
      await db.delete(user).where(eq(user.id, newUserId));
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

  describe("Relation Filters", () => {
    it("should query post with filtered comments (one-to-many with where)", async () => {
      // Create additional comments for filtering
      const comment1Id = generateUlid();
      const comment2Id = generateUlid();

      await db.insert(comment).values([
        {
          id: comment1Id,
          text: "This is a special comment",
          postId: testData.postId,
          userId: testData.userId,
        },
        {
          id: comment2Id,
          text: "Regular comment here",
          postId: testData.postId,
          userId: testData.userId,
        },
      ]);

      // Query with filter on one-to-many relation
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            comments(where: { text: { like: "%special%" } }) {
              id
              text
            }
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindMany as any[]).toHaveLength(1);
      const post = (data?.postFindMany as any[])[0];
      expect(post.id).toBe(testData.postId);
      expect(post.comments).toBeDefined();
      expect(Array.isArray(post.comments)).toBe(true);
      expect(post.comments.length).toBe(1);
      expect(post.comments[0].text).toBe("This is a special comment");
      expect(post.comments[0].id).toBe(comment1Id);

      // Cleanup
      await db.delete(comment).where(eq(comment.id, comment1Id));
      await db.delete(comment).where(eq(comment.id, comment2Id));
    });

    it("should query user with filtered posts and nested filtered comments", async () => {
      // Create additional data for complex filtering
      const post2Id = generateUlid();
      const comment3Id = generateUlid();

      await db.insert(post).values({
        id: post2Id,
        title: "Important Post",
        content: "Important content",
        authorId: testData.userId,
      });

      await db.insert(comment).values({
        id: comment3Id,
        text: "Urgent comment",
        postId: post2Id,
        userId: testData.userId,
      });

      // Query with nested filters on one-to-many relations
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindMany(where: { id: { eq: $userId } }) {
            id
            name
            posts(where: { title: { like: "%Important%" } }) {
              id
              title
              comments(where: { text: { like: "%Urgent%" } }) {
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
      expect(user.posts).toBeDefined();
      expect(user.posts.length).toBe(1);
      expect(user.posts[0].title).toBe("Important Post");
      expect(user.posts[0].comments).toBeDefined();
      expect(user.posts[0].comments.length).toBe(1);
      expect(user.posts[0].comments[0].text).toBe("Urgent comment");

      // Cleanup
      await db.delete(comment).where(eq(comment.id, comment3Id));
      await db.delete(post).where(eq(post.id, post2Id));
    });

    it("should return empty array for comments when filter does not match (one-to-many)", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            comments(where: { text: { eq: "Non-existent comment text" } }) {
              id
              text
            }
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindMany as any[]).toHaveLength(1);
      const post = (data?.postFindMany as any[])[0];
      expect(post.comments).toBeDefined();
      expect(Array.isArray(post.comments)).toBe(true);
      expect(post.comments.length).toBe(0);
    });

    it("should query posts with filtered author relation that matches", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!, $userName: String!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            author(where: { name: { eq: $userName } }) {
              id
              name
            }
          }
        }
      `,
        { postId: testData.postId, userName: "Test User" }
      );

      expect(data?.postFindMany as any[]).toHaveLength(1);
      const post = (data?.postFindMany as any[])[0];
      expect(post.id).toBe(testData.postId);
      expect(post.author).toBeDefined();
      expect(post.author.name).toBe("Test User");
    });

    it("should return null for author when filter does not match", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            author(where: { name: { eq: "Non Existent User" } }) {
              id
              name
            }
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindMany as any[]).toHaveLength(1);
      const post = (data?.postFindMany as any[])[0];
      expect(post.id).toBe(testData.postId);
      expect(post.author).toBeNull();
    });

    it("should query comments with filtered user and post relations", async () => {
      const data = await executeQuery(
        `
        query($commentId: ULID!, $userName: String!, $postTitle: String!) {
          commentFindMany(where: { id: { eq: $commentId } }) {
            id
            text
            user(where: { name: { eq: $userName } }) {
              id
              name
            }
            post(where: { title: { eq: $postTitle } }) {
              id
              title
            }
          }
        }
      `,
        {
          commentId: testData.commentId,
          userName: "Test User",
          postTitle: "Test Post",
        }
      );

      expect(data?.commentFindMany as any[]).toHaveLength(1);
      const comment = (data?.commentFindMany as any[])[0];
      expect(comment.id).toBe(testData.commentId);
      expect(comment.user).toBeDefined();
      expect(comment.user.name).toBe("Test User");
      expect(comment.post).toBeDefined();
      expect(comment.post.title).toBe("Test Post");
    });

    it("should handle multiple posts with mixed filtered relations", async () => {
      // Create another user
      const otherUserId = generateUlid();
      await db.insert(user).values({
        id: otherUserId,
        name: "Other User",
        email: "other@example.com",
      });

      // Create post by the other user
      const otherPostId = generateUlid();
      await db.insert(post).values({
        id: otherPostId,
        title: "Other Post",
        content: "Other content",
        authorId: otherUserId,
      });

      const data = await executeQuery(
        `
        query {
          postFindMany {
            id
            title
            author(where: { name: { eq: "Test User" } }) {
              id
              name
            }
          }
        }
      `
      );

      expect(data?.postFindMany as any[]).toBeInstanceOf(Array);
      const posts = data?.postFindMany as any[];

      // Find the test post
      const testPost = posts.find((p: any) => p.id === testData.postId);
      expect(testPost).toBeDefined();
      expect(testPost.author).toBeDefined();
      expect(testPost.author.name).toBe("Test User");

      // Find the other post - author should be null because filter doesn't match
      const otherPost = posts.find((p: any) => p.id === otherPostId);
      expect(otherPost).toBeDefined();
      expect(otherPost.author).toBeNull();

      // Cleanup
      await db.delete(post).where(eq(post.id, otherPostId));
      await db.delete(user).where(eq(user.id, otherUserId));
    });
  });

  describe("FindFirst Query Tests", () => {
    it("should query single user with findFirst", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindFirst(where: { id: { eq: $userId } }) {
            id
            name
            email
            bio
            _operation
          }
        }
      `,
        { userId: testData.userId }
      );

      expect(data?.userFindFirst).toBeDefined();
      expect((data?.userFindFirst as any).id).toBe(testData.userId);
      expect((data?.userFindFirst as any).name).toBe("Test User");
      expect((data?.userFindFirst as any)._operation).toBe("READ");
    });

    it("should query single post with findFirst", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindFirst(where: { id: { eq: $postId } }) {
            id
            title
            content
            authorId
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindFirst).toBeDefined();
      expect((data?.postFindFirst as any).id).toBe(testData.postId);
      expect((data?.postFindFirst as any).title).toBe("Test Post");
    });

    it("should return null when no match with findFirst", async () => {
      const nonExistentId = generateUlid(); // Generate a valid ULID that doesn't exist
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindFirst(where: { id: { eq: $userId } }) {
            id
            name
          }
        }
      `,
        { userId: nonExistentId }
      );

      expect(data?.userFindFirst).toBeNull();
    });

    it("should query findFirst with relations", async () => {
      const data = await executeQuery(
        `
        query($userId: ULID!) {
          userFindFirst(where: { id: { eq: $userId } }) {
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
        }
      `,
        { userId: testData.userId }
      );

      expect(data?.userFindFirst).toBeDefined();
      const user = data?.userFindFirst as any;
      expect(user.id).toBe(testData.userId);
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBeGreaterThan(0);
      expect(user.profile).toBeDefined();
      expect(user.profile.id).toBe(testData.profileId);
    });

    it("should query findFirst with nested relations", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindFirst(where: { id: { eq: $postId } }) {
            id
            title
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
        { postId: testData.postId }
      );

      expect(data?.postFindFirst).toBeDefined();
      const post = data?.postFindFirst as any;
      expect(post.id).toBe(testData.postId);
      expect(post.author).toBeDefined();
      expect(post.author.id).toBe(testData.userId);
      expect(post.comments).toBeDefined();
      expect(Array.isArray(post.comments)).toBe(true);
    });

    it("should query findFirst with orderBy", async () => {
      const data = await executeQuery(`
        query {
          userFindFirst(orderBy: { name: { direction: asc, priority: 1 } }) {
            id
            name
          }
        }
      `);

      expect(data?.userFindFirst).toBeDefined();
      expect(data?.userFindFirst as any).toHaveProperty("id");
      expect(data?.userFindFirst as any).toHaveProperty("name");
    });

    it("should query findFirst with filtered relations", async () => {
      const data = await executeQuery(
        `
        query($postId: ULID!) {
          postFindFirst(where: { id: { eq: $postId } }) {
            id
            title
            comments(where: { text: { like: "%Test%" } }) {
              id
              text
            }
          }
        }
      `,
        { postId: testData.postId }
      );

      expect(data?.postFindFirst).toBeDefined();
      const post = data?.postFindFirst as any;
      expect(post.comments).toBeDefined();
      expect(Array.isArray(post.comments)).toBe(true);
    });
  });

  describe("Export Tool Integration Tests - With Variables (WORKING SOLUTION)", () => {
    /**
     * ✅ WORKING SOLUTION: Using GraphQL variables with default values
     *
     * Instead of using $_varName directly in the query string, we:
     * 1. Declare GraphQL variables with FlexibleULID type
     * 2. Set default values (empty string) to pass validation
     * 3. Let the middleware resolve $_varName patterns in the actual values
     *
     * Example:
     * query GetPosts($authorId: ULID = "") {
     *   user: userFindFirst(...) {
     *     id @export(as: "authorId")
     *   }
     *   posts: postFindMany(where: { authorId: { eq: $authorId } }) { ... }
     * }
     *
     * Then call with variables: { authorId: "$_authorId" }
     *
     * This works because:
     * - FlexibleULID type accepts $_varName patterns and empty strings
     * - Default value satisfies parse-time validation
     * - Middleware resolves the pattern at execution time
     */

    it("should export and use value via String variable with default", async () => {
      const data = await executeQueryWithExport(
        `
        query GetUserPosts($authorId: ULID = "") {
          user: userFindFirst(where: { email: { eq: "${testData.testEmail}" } }) {
            id @export(as: "authorId")
            name
            email
          }
          posts: postFindMany(where: { authorId: { eq: $authorId } }) {
            id
            title
            authorId
          }
        }
      `,
        { authorId: "$_authorId" }
      );

      expect(data?.user).toBeDefined();
      expect((data?.user as any).id).toBe(testData.userId);
      expect(data?.posts).toBeDefined();
      expect(Array.isArray(data?.posts)).toBe(true);
      expect((data?.posts as any[]).length).toBeGreaterThan(0);
      expect((data?.posts as any[])[0].authorId).toBe(testData.userId);
    });

    it("should handle multiple variables with exports (nested field timing issue)", async () => {
      const data = await executeQueryWithExport(
        `
        query GetUserData($userId: ULID = "", $postId: ULID = "") {
          user: userFindFirst(where: { email: { eq: "${testData.testEmail}" } }) {
            id @export(as: "userId")
            name
            posts {
              id @export(as: "postId")
              title
            }
          }
          profile: userProfileFindFirst(where: { userId: { eq: $userId } }) {
            id
            bio
            userId
          }
          comments: commentFindMany(where: { postId: { eq: $postId } }) {
            id
            text
            postId
          }
        }
      `,
        { userId: "$_userId", postId: "$_postId" }
      );

      expect(data?.user).toBeDefined();
      expect((data?.user as any).id).toBe(testData.userId);

      expect(data?.profile).toBeDefined();
      expect((data?.profile as any).userId).toBe(testData.userId);

      expect(data?.comments).toBeDefined();
      expect(Array.isArray(data?.comments)).toBe(true);
    });

    it("should work with mutation and variable (requires shared context across requests)", async () => {
      const newEmail = `export-var-test-${generateUlid()}@example.com`;

      // Create shared context with ExportStore for both operations
      const sharedContext = { exportStore: new ExportStore() };

      // First create the user with export
      const createResult = await executeQueryWithExport(
        `
        mutation CreateUser {
          newUser: userInsertMany(values: [{ 
            name: "Variable Export Test", 
            email: "${newEmail}"
          }]) {
            id @export(as: "newUserId")
            name
            email
          }
        }
      `,
        undefined,
        sharedContext
      );

      expect(createResult?.newUser).toBeDefined();
      expect((createResult?.newUser as any[])[0]).toHaveProperty("id");
      const newUserId = (createResult?.newUser as any[])[0].id;

      // Then query it using the exported value from the same context
      // Note: newUserId export is an array (from userInsertMany), so we must accept [ULID]
      const queryResult = await executeQueryWithExport(
        `
        query VerifyUser($userIds: [ULID!]) {
          verifyUser: userFindFirst(where: { id: { inArray: $userIds } }) {
            id
            name
            email
          }
        }
      `,
        { userIds: "$_newUserId" },
        sharedContext // Reuse the same context!
      );

      expect(queryResult?.verifyUser).toBeDefined();
      expect((queryResult?.verifyUser as any).id).toBe(newUserId);
      expect((queryResult?.verifyUser as any).name).toBe(
        "Variable Export Test"
      );

      // Cleanup
      await db.delete(user).where(eq(user.id, newUserId));
    });

    it("should handle nested exports with variables (parallel execution timing)", async () => {
      const data = await executeQueryWithExport(
        `
        query NestedExport($authorId: ULID = "") {
          post: postFindFirst(where: { title: { eq: "Test Post" } }) {
            id
            title
            author {
              id @export(as: "authorId")
              name
            }
          }
          authorPosts: postFindMany(where: { authorId: { eq: $authorId } }) {
            id
            title
            authorId
          }
        }
      `,
        { authorId: "$_authorId" }
      );

      expect(data?.post).toBeDefined();
      expect((data?.post as any).author).toBeDefined();
      expect((data?.post as any).author.id).toBe(testData.userId);

      expect(data?.authorPosts).toBeDefined();
      const authorPosts = data?.authorPosts as any[];
      expect(authorPosts.length).toBeGreaterThan(0);
      authorPosts.forEach((post: any) => {
        expect(post.authorId).toBe(testData.userId);
      });
    });

    it("should work with nullable variables", async () => {
      const data = await executeQueryWithExport(
        `
        query WithNullable($userId: ULID = "") {
          user: userFindFirst(where: { email: { eq: "${testData.testEmail}" } }) {
            id @export(as: "userId")
            name
          }
          posts: postFindMany(where: { authorId: { eq: $userId } }) {
            id
            title
          }
        }
      `,
        { userId: "$_userId" }
      );

      expect(data?.user).toBeDefined();
      expect(data?.posts).toBeDefined();
      expect((data?.posts as any[]).length).toBeGreaterThan(0);
    });

    it("should handle complex sequenced queries with variables", async () => {
      const data = await executeQueryWithExport(
        `
        query SequencedExports($userId: ULID = "", $postId: ULID = "") {
          step1: userFindFirst(where: { email: { eq: "${testData.testEmail}" } }) {
            id @export(as: "userId")
            name
          }
          step2: postFindFirst(where: { authorId: { eq: $userId } }) {
            id @export(as: "postId")
            title
            authorId
          }
          step3: commentFindMany(where: { postId: { eq: $postId } }) {
            id
            text
            postId
          }
        }
      `,
        { userId: "$_userId", postId: "$_postId" }
      );

      expect(data?.step1).toBeDefined();
      expect((data?.step1 as any).id).toBe(testData.userId);

      expect(data?.step2).toBeDefined();
      expect((data?.step2 as any).authorId).toBe(testData.userId);

      expect(data?.step3).toBeDefined();
      const comments = data?.step3 as any[];
      if (comments.length > 0) {
        expect(comments[0].postId).toBe((data?.step2 as any).id);
      }
    });
  });
});

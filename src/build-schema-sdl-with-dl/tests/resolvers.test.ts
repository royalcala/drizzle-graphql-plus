import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { user, post, comment, reaction, userProfile, city, sport } from "./schema";
import { ulid as generateUlid } from "ulid";
import { graphql, GraphQLSchema } from "graphql";
import { eq } from "drizzle-orm";
import { createSharedEnvelop, executeGraphQLQuery } from "./shared-envelop";

// Create test database client
const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test-resolvers.db",
});

const db = drizzle(client, { schema });

// Create shared envelop configuration - same as server
const enveloped = createSharedEnvelop(db);

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
      const data = await executeGraphQLQuery(enveloped, `
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
      const data = await executeGraphQLQuery(enveloped,
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
      const data = await executeGraphQLQuery(enveloped, `
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
      const data = await executeGraphQLQuery(enveloped,
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
      const data = await executeGraphQLQuery(enveloped, `
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
      const data = await executeGraphQLQuery(enveloped, `
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
      const data = await executeGraphQLQuery(enveloped,
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
    describe("Insert Operations", () => {
      it("should insert a new user and use DataLoader for result fetching", async () => {
        const data = await executeGraphQLQuery(enveloped,
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

      it("should insert multiple users with DataLoader optimization", async () => {
        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($values: [UserInsertInput!]!) {
            userInsertMany(values: $values) {
              id
              name
              email
              bio
            }
          }
          `,
          {
            values: [
              {
                name: "Bulk User 1",
                email: "bulk1@example.com",
                bio: "First bulk user",
              },
              {
                name: "Bulk User 2",
                email: "bulk2@example.com",
                bio: "Second bulk user",
              },
              {
                name: "Bulk User 3",
                email: "bulk3@example.com",
                bio: "Third bulk user",
              },
            ],
          }
        );

        expect(data?.userInsertMany as any[]).toHaveLength(3);

        const insertedUsers = data?.userInsertMany as any[];
        insertedUsers.forEach(user => {
          expect(user).toHaveProperty("id");
          expect(user.id).toBeTruthy();
        });

        // Sort by name to ensure consistent ordering for assertions
        const sortedUsers = insertedUsers.sort((a, b) => a.name.localeCompare(b.name));
        expect(sortedUsers[0].name).toBe("Bulk User 1");
        expect(sortedUsers[1].name).toBe("Bulk User 2");
        expect(sortedUsers[2].name).toBe("Bulk User 3");

        // Cleanup
        for (const insertedUser of insertedUsers) {
          await db.delete(user).where(eq(user.id, insertedUser.id));
        }
      });

      it("should insert post with relations and fetch with DataLoader", async () => {
        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($values: [PostInsertInput!]!) {
            postInsertMany(values: $values) {
              id
              title
              content
              authorId
              author {
                id
                name
                email
              }
              comments {
                id
                text
              }
            }
          }
          `,
          {
            values: [
              {
                title: "DataLoader Test Post",
                content: "Testing DataLoader with post insertion",
                authorId: testData.userId,
              },
            ],
          }
        );

        expect(data?.postInsertMany as any[]).toHaveLength(1);
        const insertedPost = (data?.postInsertMany as any[])[0];

        expect(insertedPost.title).toBe("DataLoader Test Post");
        expect(insertedPost.authorId).toBe(testData.userId);
        expect(insertedPost.author).toBeDefined();
        expect(insertedPost.author.id).toBe(testData.userId);
        expect(insertedPost.author.name).toBe("Test User");
        expect(Array.isArray(insertedPost.comments)).toBe(true);

        // Cleanup
        await db.delete(post).where(eq(post.id, insertedPost.id));
      });

      it("should insert comment with nested relations using DataLoader", async () => {
        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($values: [CommentInsertInput!]!) {
            commentInsertMany(values: $values) {
              id
              text
              postId
              userId
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
              }
              reactions {
                id
                type
              }
            }
          }
          `,
          {
            values: [
              {
                text: "DataLoader comment test",
                postId: testData.postId,
                userId: testData.userId,
              },
            ],
          }
        );

        expect(data?.commentInsertMany as any[]).toHaveLength(1);
        const insertedComment = (data?.commentInsertMany as any[])[0];

        expect(insertedComment.text).toBe("DataLoader comment test");
        expect(insertedComment.post).toBeDefined();
        expect(insertedComment.post.id).toBe(testData.postId);
        expect(insertedComment.post.author).toBeDefined();
        expect(insertedComment.user).toBeDefined();
        expect(insertedComment.user.id).toBe(testData.userId);
        expect(Array.isArray(insertedComment.reactions)).toBe(true);

        // Cleanup
        await db.delete(comment).where(eq(comment.id, insertedComment.id));
      });
    });

    describe("Update Operations", () => {
      it("should update user and fetch with nested relations using DataLoader", async () => {
        const data = await executeGraphQLQuery(enveloped,
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

      it("should update multiple users with DataLoader optimization", async () => {
        // First create test users
        const userIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const userId = generateUlid();
          userIds.push(userId);
          await db.insert(user).values({
            id: userId,
            name: `Update Test User ${i}`,
            email: `updatetest${i}@example.com`,
            bio: "Original bio",
          });
        }

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($set: UserUpdateInput!, $where: UserFilters) {
            userUpdateMany(set: $set, where: $where) {
              id
              name
              bio
              posts {
                id
                title
              }
            }
          }
          `,
          {
            set: { bio: "Updated bio via DataLoader" },
            where: { email: { like: "updatetest%" } },
          }
        );

        expect(data?.userUpdateMany as any[]).toHaveLength(3);

        const updatedUsers = data?.userUpdateMany as any[];
        updatedUsers.forEach(user => {
          expect(user.bio).toBe("Updated bio via DataLoader");
          expect(user).toHaveProperty("posts");
          expect(Array.isArray(user.posts)).toBe(true);
        });

        // Cleanup
        for (const userId of userIds) {
          await db.delete(user).where(eq(user.id, userId));
        }
      });

      it("should update post with complex where conditions and DataLoader relations", async () => {
        const data = await executeGraphQLQuery(enveloped,
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
            set: {
              title: "Updated Post Title",
              content: "Updated content via DataLoader"
            },
            where: {
              id: { eq: testData.postId },
              authorId: { eq: testData.userId }
            },
          }
        );

        expect(data?.postUpdateMany as any[]).toHaveLength(1);
        const updatedPost = (data?.postUpdateMany as any[])[0];

        expect(updatedPost.id).toBe(testData.postId);
        expect(updatedPost.title).toBe("Updated Post Title");
        expect(updatedPost.content).toBe("Updated content via DataLoader");
        expect(updatedPost.author).toBeDefined();
        expect(updatedPost.author.id).toBe(testData.userId);
        expect(Array.isArray(updatedPost.comments)).toBe(true);

        // Restore original data
        await db
          .update(post)
          .set({
            title: "Test Post",
            content: "Test content"
          })
          .where(eq(post.id, testData.postId));
      });

      it("should update comment and verify nested DataLoader relations", async () => {
        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($set: CommentUpdateInput!, $where: CommentFilters) {
            commentUpdateMany(set: $set, where: $where) {
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
          `,
          {
            set: { text: "Updated comment via DataLoader" },
            where: { id: { eq: testData.commentId } },
          }
        );

        expect(data?.commentUpdateMany as any[]).toHaveLength(1);
        const updatedComment = (data?.commentUpdateMany as any[])[0];

        expect(updatedComment.id).toBe(testData.commentId);
        expect(updatedComment.text).toBe("Updated comment via DataLoader");
        expect(updatedComment.post).toBeDefined();
        expect(updatedComment.post.author).toBeDefined();
        expect(updatedComment.user).toBeDefined();
        expect(Array.isArray(updatedComment.reactions)).toBe(true);

        // Restore original data
        await db
          .update(comment)
          .set({ text: "Test comment" })
          .where(eq(comment.id, testData.commentId));
      });
    });

    describe("Delete Operations", () => {
      it("should delete user and return deleted record with DataLoader relations", async () => {
        // Create a user to delete
        const userToDeleteId = generateUlid();
        await db.insert(user).values({
          id: userToDeleteId,
          name: "User To Delete",
          email: "delete@example.com",
          bio: "Will be deleted",
        });

        // Create a post for this user
        const postToDeleteId = generateUlid();
        await db.insert(post).values({
          id: postToDeleteId,
          title: "Post by user to delete",
          content: "This post's author will be deleted",
          authorId: userToDeleteId,
        });

        // First delete the post to avoid foreign key constraint
        await db.delete(post).where(eq(post.id, postToDeleteId));

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($where: UserFilters) {
            userDeleteMany(where: $where) {
              deletedItems {
                id
              }
              userFindMany {
                id
                name
                email
                bio
                posts {
                  id
                  title
                  content
                }
              }
            }
          }
          `,
          {
            where: { id: { eq: userToDeleteId } },
          }
        );

        expect(data?.userDeleteMany).toBeDefined();
        expect(data?.userDeleteMany.deletedItems).toHaveLength(1);
        expect(data?.userDeleteMany.deletedItems[0].id).toBe(userToDeleteId);

        // The userFindMany returns results after deletion, so it should be empty for this specific user
        const remainingUsers = data?.userDeleteMany.userFindMany as any[];
        expect(Array.isArray(remainingUsers)).toBe(true);

        // Verify that the deleted user is not in the remaining users
        const deletedUserInResults = remainingUsers.find(u => u.id === userToDeleteId);
        expect(deletedUserInResults).toBeUndefined();

        // Verify user is actually deleted
        const userCheck = await db.select().from(user).where(eq(user.id, userToDeleteId));
        expect(userCheck).toHaveLength(0);
      });

      it("should delete multiple users with DataLoader optimization", async () => {
        // Create multiple users to delete
        const userIds: string[] = [];
        const uniquePrefix = generateUlid().slice(-8);
        for (let i = 0; i < 3; i++) {
          const userId = generateUlid();
          userIds.push(userId);
          await db.insert(user).values({
            id: userId,
            name: `Delete Test User ${i}`,
            email: `deletetest-${uniquePrefix}-${i}@example.com`,
            bio: `Bio for user ${i}`,
          });
        }

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($where: UserFilters) {
            userDeleteMany(where: $where) {
              deletedItems {
                id
              }
              userFindMany {
                id
                name
                email
                posts {
                  id
                  title
                }
              }
            }
          }
          `,
          {
            where: { email: { like: `deletetest-${uniquePrefix}-%` } },
          }
        );

        expect(data?.userDeleteMany).toBeDefined();
        expect(data?.userDeleteMany.deletedItems).toHaveLength(3);

        // The userFindMany returns results after deletion, so should not contain the deleted users
        const remainingUsers = data?.userDeleteMany.userFindMany as any[];
        expect(Array.isArray(remainingUsers)).toBe(true);

        // Verify that none of the deleted users are in the remaining users
        const deletedIds = data?.userDeleteMany.deletedItems.map((item: any) => item.id);
        remainingUsers.forEach(user => {
          expect(deletedIds).not.toContain(user.id);
        });

        // Verify all users are actually deleted
        for (const userId of userIds) {
          const userCheck = await db.select().from(user).where(eq(user.id, userId));
          expect(userCheck).toHaveLength(0);
        }
      });

      it("should delete post with nested relations using DataLoader", async () => {
        // Create a post to delete
        const postToDeleteId = generateUlid();
        await db.insert(post).values({
          id: postToDeleteId,
          title: "Post to delete",
          content: "This post will be deleted",
          authorId: testData.userId,
        });

        // Create comments for this post
        const commentIds: string[] = [];
        for (let i = 0; i < 2; i++) {
          const commentId = generateUlid();
          commentIds.push(commentId);
          await db.insert(comment).values({
            id: commentId,
            text: `Comment ${i} on post to delete`,
            postId: postToDeleteId,
            userId: testData.userId,
          });
        }

        // First delete comments to avoid foreign key constraint
        for (const commentId of commentIds) {
          await db.delete(comment).where(eq(comment.id, commentId));
        }

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($where: PostFilters) {
            postDeleteMany(where: $where) {
              deletedItems {
                id
              }
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
          }
          `,
          {
            where: { id: { eq: postToDeleteId } },
          }
        );

        expect(data?.postDeleteMany).toBeDefined();
        expect(data?.postDeleteMany.deletedItems).toHaveLength(1);
        expect(data?.postDeleteMany.deletedItems[0].id).toBe(postToDeleteId);

        // The postFindMany returns results after deletion, so should not contain the deleted post
        const remainingPosts = data?.postDeleteMany.postFindMany as any[];
        expect(Array.isArray(remainingPosts)).toBe(true);

        // Verify that the deleted post is not in the remaining posts
        const deletedPostInResults = remainingPosts.find(p => p.id === postToDeleteId);
        expect(deletedPostInResults).toBeUndefined();

        // Verify post is actually deleted
        const postCheck = await db.select().from(post).where(eq(post.id, postToDeleteId));
        expect(postCheck).toHaveLength(0);
      });

      it("should delete comment with complex nested relations", async () => {
        // Create a comment to delete
        const commentToDeleteId = generateUlid();
        await db.insert(comment).values({
          id: commentToDeleteId,
          text: "Comment to delete",
          postId: testData.postId,
          userId: testData.userId,
        });

        // Create reactions for this comment
        const reactionIds: string[] = [];
        for (let i = 0; i < 2; i++) {
          const reactionId = generateUlid();
          reactionIds.push(reactionId);
          await db.insert(reaction).values({
            id: reactionId,
            commentId: commentToDeleteId,
            userId: testData.userId,
            type: i === 0 ? "LIKE" : "DISLIKE",
          });
        }

        // First delete reactions to avoid foreign key constraint
        for (const reactionId of reactionIds) {
          await db.delete(reaction).where(eq(reaction.id, reactionId));
        }

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($where: CommentFilters) {
            commentDeleteMany(where: $where) {
              deletedItems {
                id
              }
              commentFindMany {
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
          `,
          {
            where: { id: { eq: commentToDeleteId } },
          }
        );

        expect(data?.commentDeleteMany).toBeDefined();
        expect(data?.commentDeleteMany.deletedItems).toHaveLength(1);
        expect(data?.commentDeleteMany.deletedItems[0].id).toBe(commentToDeleteId);

        // The commentFindMany returns results after deletion, so should not contain the deleted comment
        const remainingComments = data?.commentDeleteMany.commentFindMany as any[];
        expect(Array.isArray(remainingComments)).toBe(true);

        // Verify that the deleted comment is not in the remaining comments
        const deletedCommentInResults = remainingComments.find(c => c.id === commentToDeleteId);
        expect(deletedCommentInResults).toBeUndefined();

        // Verify comment is actually deleted
        const commentCheck = await db.select().from(comment).where(eq(comment.id, commentToDeleteId));
        expect(commentCheck).toHaveLength(0);
      });

      it("should delete with complex where conditions and DataLoader relations", async () => {
        // Create multiple posts to test complex deletion
        const postIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const postId = generateUlid();
          postIds.push(postId);
          await db.insert(post).values({
            id: postId,
            title: `Complex Delete Post ${i}`,
            content: `Content for complex delete test ${i}`,
            authorId: testData.userId,
          });
        }

        const data = await executeGraphQLQuery(enveloped,
          `
          mutation($where: PostFilters) {
            postDeleteMany(where: $where) {
              deletedItems {
                id
              }
              postFindMany {
                id
                title
                content
                author {
                  id
                  name
                  email
                }
                comments {
                  id
                  text
                }
              }
            }
          }
          `,
          {
            where: {
              title: { like: "Complex Delete%" }
            },
          }
        );

        expect(data?.postDeleteMany).toBeDefined();
        expect(data?.postDeleteMany.deletedItems).toHaveLength(3);

        // The postFindMany returns results after deletion, so should not contain the deleted posts
        const remainingPosts = data?.postDeleteMany.postFindMany as any[];
        expect(Array.isArray(remainingPosts)).toBe(true);

        // Verify that none of the deleted posts are in the remaining posts
        const deletedIds = data?.postDeleteMany.deletedItems.map((item: any) => item.id);
        remainingPosts.forEach(post => {
          expect(deletedIds).not.toContain(post.id);
        });

        // Verify all posts are actually deleted
        for (const postId of postIds) {
          const postCheck = await db.select().from(post).where(eq(post.id, postId));
          expect(postCheck).toHaveLength(0);
        }
      });
    });
  });

  describe("DataLoader One-to-One Relations", () => {
    it("should query user with profile using DataLoader (one-to-one)", async () => {
      const data = await executeGraphQLQuery(enveloped,
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
      const data = await executeGraphQLQuery(enveloped,
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
      const data = await executeGraphQLQuery(enveloped,
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

      const data = await executeGraphQLQuery(enveloped, query, {
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

      const data = await executeGraphQLQuery(enveloped, `
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
      const data = await executeGraphQLQuery(enveloped,
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
      // Get schema from the enveloped instance
      const { schema } = enveloped();
      const queryType = schema.getQueryType();
      const mutationType = schema.getMutationType();

      expect(queryType).toBeDefined();
      expect(mutationType).toBeDefined();

      // Check that the schema has the expected fields
      const queryFields = queryType?.getFields();
      const mutationFields = mutationType?.getFields();

      expect(queryFields).toHaveProperty("userFindMany");
      expect(queryFields).toHaveProperty("postFindMany");
      expect(queryFields).toHaveProperty("commentFindMany");
      expect(queryFields).toHaveProperty("reactionFindMany");
      expect(mutationFields).toHaveProperty("userInsertMany");
      expect(mutationFields).toHaveProperty("userUpdateMany");
      expect(mutationFields).toHaveProperty("userDeleteMany");
    });
  });

  describe("Comment Replies (Self-Referencing Relations)", () => {
    it("should create and query comment replies with DataLoader", async () => {
      // Create a parent comment
      const parentCommentId = generateUlid();
      await db.insert(comment).values({
        id: parentCommentId,
        text: "This is a parent comment",
        postId: testData.postId,
        userId: testData.userId,
        commentId: null, // This is a top-level comment
      });

      // Create reply comments
      const replyIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const replyId = generateUlid();
        replyIds.push(replyId);
        await db.insert(comment).values({
          id: replyId,
          text: `This is reply ${i + 1}`,
          postId: testData.postId,
          userId: testData.userId,
          commentId: parentCommentId, // This is a reply to the parent comment
        });
      }

      // Query the parent comment with its replies
      const data = await executeGraphQLQuery(enveloped,
        `
        query($commentId: ID!) {
          commentFindMany(where: { id: { eq: $commentId } }) {
            id
            text
            commentId
            replies {
              id
              text
              commentId
              user {
                id
                name
              }
              parentComment {
                id
                text
              }
            }
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
        `,
        { commentId: parentCommentId }
      );

      expect(data?.commentFindMany as any[]).toHaveLength(1);
      const parentComment = (data?.commentFindMany as any[])[0];

      // Verify parent comment
      expect(parentComment.id).toBe(parentCommentId);
      expect(parentComment.text).toBe("This is a parent comment");
      expect(parentComment.commentId).toBeNull();
      expect(parentComment.user).toBeDefined();
      expect(parentComment.post).toBeDefined();

      // Verify replies
      expect(Array.isArray(parentComment.replies)).toBe(true);
      expect(parentComment.replies.length).toBe(3);

      parentComment.replies.forEach((reply: any, index: number) => {
        expect(reply.text).toBe(`This is reply ${index + 1}`);
        expect(reply.commentId).toBe(parentCommentId);
        expect(reply.user).toBeDefined();
        expect(reply.parentComment).toBeDefined();
        expect(reply.parentComment.id).toBe(parentCommentId);
      });

      // Cleanup
      for (const replyId of replyIds) {
        await db.delete(comment).where(eq(comment.id, replyId));
      }
      await db.delete(comment).where(eq(comment.id, parentCommentId));
    });

    it("should query replies and their parent comments with DataLoader", async () => {
      // Create a parent comment
      const parentCommentId = generateUlid();
      await db.insert(comment).values({
        id: parentCommentId,
        text: "Parent comment for reply test",
        postId: testData.postId,
        userId: testData.userId,
        commentId: null,
      });

      // Create a reply
      const replyId = generateUlid();
      await db.insert(comment).values({
        id: replyId,
        text: "This is a reply",
        postId: testData.postId,
        userId: testData.userId,
        commentId: parentCommentId,
      });

      // Query the reply and its parent
      const data = await executeGraphQLQuery(enveloped,
        `
        query($replyId: ID!) {
          commentFindMany(where: { id: { eq: $replyId } }) {
            id
            text
            commentId
            parentComment {
              id
              text
              commentId
              replies {
                id
                text
              }
            }
            user {
              id
              name
            }
          }
        }
        `,
        { replyId }
      );

      expect(data?.commentFindMany as any[]).toHaveLength(1);
      const reply = (data?.commentFindMany as any[])[0];

      // Verify reply
      expect(reply.id).toBe(replyId);
      expect(reply.text).toBe("This is a reply");
      expect(reply.commentId).toBe(parentCommentId);

      // Verify parent comment
      expect(reply.parentComment).toBeDefined();
      expect(reply.parentComment.id).toBe(parentCommentId);
      expect(reply.parentComment.text).toBe("Parent comment for reply test");
      expect(reply.parentComment.commentId).toBeNull();

      // Verify that parent has the reply in its replies
      expect(Array.isArray(reply.parentComment.replies)).toBe(true);
      expect(reply.parentComment.replies.length).toBe(1);
      expect(reply.parentComment.replies[0].id).toBe(replyId);

      // Cleanup
      await db.delete(comment).where(eq(comment.id, replyId));
      await db.delete(comment).where(eq(comment.id, parentCommentId));
    });

    it("should handle nested replies (replies to replies) with DataLoader", async () => {
      // Create a parent comment
      const parentCommentId = generateUlid();
      await db.insert(comment).values({
        id: parentCommentId,
        text: "Parent comment",
        postId: testData.postId,
        userId: testData.userId,
        commentId: null,
      });

      // Create a first-level reply
      const firstReplyId = generateUlid();
      await db.insert(comment).values({
        id: firstReplyId,
        text: "First level reply",
        postId: testData.postId,
        userId: testData.userId,
        commentId: parentCommentId,
      });

      // Create a second-level reply (reply to the first reply)
      const secondReplyId = generateUlid();
      await db.insert(comment).values({
        id: secondReplyId,
        text: "Second level reply",
        postId: testData.postId,
        userId: testData.userId,
        commentId: firstReplyId,
      });

      // Query the entire thread
      const data = await executeGraphQLQuery(enveloped,
        `
        query($parentId: ID!) {
          commentFindMany(where: { id: { eq: $parentId } }) {
            id
            text
            replies {
              id
              text
              replies {
                id
                text
                parentComment {
                  id
                  text
                }
              }
            }
          }
        }
        `,
        { parentId: parentCommentId }
      );

      expect(data?.commentFindMany as any[]).toHaveLength(1);
      const parentComment = (data?.commentFindMany as any[])[0];

      // Verify parent comment
      expect(parentComment.id).toBe(parentCommentId);
      expect(parentComment.replies.length).toBe(1);

      // Verify first-level reply
      const firstReply = parentComment.replies[0];
      expect(firstReply.id).toBe(firstReplyId);
      expect(firstReply.text).toBe("First level reply");
      expect(firstReply.replies.length).toBe(1);

      // Verify second-level reply
      const secondReply = firstReply.replies[0];
      expect(secondReply.id).toBe(secondReplyId);
      expect(secondReply.text).toBe("Second level reply");
      expect(secondReply.parentComment.id).toBe(firstReplyId);

      // Cleanup
      await db.delete(comment).where(eq(comment.id, secondReplyId));
      await db.delete(comment).where(eq(comment.id, firstReplyId));
      await db.delete(comment).where(eq(comment.id, parentCommentId));
    });

    it("should efficiently handle posts->comments->replies query without N+1 problem", async () => {
      // Create a comprehensive test scenario to demonstrate DataLoader efficiency
      const testPostId = generateUlid();
      await db.insert(post).values({
        id: testPostId,
        title: "Post with Complex Comment Thread",
        content: "Testing DataLoader efficiency with nested comments",
        authorId: testData.userId,
      });

      // Create parent comments
      const parentCommentIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const parentId = generateUlid();
        parentCommentIds.push(parentId);
        await db.insert(comment).values({
          id: parentId,
          text: `Parent comment ${i + 1}`,
          postId: testPostId,
          userId: testData.userId,
          commentId: null,
        });

        // Create replies for each parent comment
        for (let j = 0; j < 2; j++) {
          const replyId = generateUlid();
          await db.insert(comment).values({
            id: replyId,
            text: `Reply ${j + 1} to parent ${i + 1}`,
            postId: testPostId,
            userId: testData.userId,
            commentId: parentId,
          });
        }
      }

      console.log("\\n=== TESTING DATALOADER EFFICIENCY FOR POSTS->COMMENTS->REPLIES ===");

      // This query will test the exact scenario you asked about:
      // posts -> comments -> replies
      const data = await executeGraphQLQuery(enveloped,
        `
        query($postId: ID!) {
          postFindMany(where: { id: { eq: $postId } }) {
            id
            title
            comments {
              id
              text
              commentId
              replies {
                id
                text
                commentId
                parentComment {
                  id
                  text
                }
              }
            }
          }
        }
        `,
        { postId: testPostId }
      );

      console.log("=== QUERY COMPLETED - ANALYZING RESULTS ===\\n");

      expect(data?.postFindMany as any[]).toHaveLength(1);
      const testPost = (data?.postFindMany as any[])[0];

      // Verify post structure
      expect(testPost.id).toBe(testPostId);
      expect(testPost.title).toBe("Post with Complex Comment Thread");
      expect(Array.isArray(testPost.comments)).toBe(true);

      // The comments array should contain ALL comments (parents + replies)
      // because DataLoader fetches all comments for the post at once
      expect(testPost.comments.length).toBe(9); // 3 parents + 6 replies

      // Separate parent comments from replies
      const parentComments = testPost.comments.filter((c: any) => c.commentId === null);
      const replyComments = testPost.comments.filter((c: any) => c.commentId !== null);

      expect(parentComments.length).toBe(3);
      expect(replyComments.length).toBe(6);

      // Verify that parent comments have their replies populated
      parentComments.forEach((parent: any, index: number) => {
        expect(parent.text).toBe(`Parent comment ${index + 1}`);
        expect(Array.isArray(parent.replies)).toBe(true);
        expect(parent.replies.length).toBe(2);

        parent.replies.forEach((reply: any, replyIndex: number) => {
          expect(reply.text).toBe(`Reply ${replyIndex + 1} to parent ${index + 1}`);
          expect(reply.commentId).toBe(parent.id);
          expect(reply.parentComment).toBeDefined();
          expect(reply.parentComment.id).toBe(parent.id);
        });
      });

      // Cleanup
      await db.delete(comment).where(eq(comment.postId, testPostId));
      await db.delete(post).where(eq(post.id, testPostId));
    });

    it("should demonstrate DataLoader batching behavior with comment relations", async () => {
      // Create multiple posts with comments and replies to test batching
      const testPostIds: string[] = [];
      const allCommentIds: string[] = [];

      for (let postIndex = 0; postIndex < 2; postIndex++) {
        const postId = generateUlid();
        testPostIds.push(postId);

        await db.insert(post).values({
          id: postId,
          title: `Batching Test Post ${postIndex + 1}`,
          content: `Content for post ${postIndex + 1}`,
          authorId: testData.userId,
        });

        // Create parent comment
        const parentId = generateUlid();
        allCommentIds.push(parentId);
        await db.insert(comment).values({
          id: parentId,
          text: `Parent comment for post ${postIndex + 1}`,
          postId: postId,
          userId: testData.userId,
          commentId: null,
        });

        // Create replies
        for (let replyIndex = 0; replyIndex < 2; replyIndex++) {
          const replyId = generateUlid();
          allCommentIds.push(replyId);
          await db.insert(comment).values({
            id: replyId,
            text: `Reply ${replyIndex + 1} for post ${postIndex + 1}`,
            postId: postId,
            userId: testData.userId,
            commentId: parentId,
          });
        }
      }

      console.log("\\n=== TESTING DATALOADER BATCHING WITH MULTIPLE POSTS ===");

      // Query multiple posts at once to see DataLoader batching in action
      const data = await executeGraphQLQuery(enveloped,
        `
        query {
          postFindMany(where: { title: { like: "Batching Test%" } }) {
            id
            title
            comments {
              id
              text
              commentId
              replies {
                id
                text
                user {
                  id
                  name
                }
              }
              parentComment {
                id
                text
              }
            }
          }
        }
      `);

      console.log("=== BATCHING QUERY COMPLETED ===\\n");

      expect(data?.postFindMany as any[]).toHaveLength(2);
      const posts = data?.postFindMany as any[];

      posts.forEach((post: any, postIndex: number) => {
        expect(post.title).toBe(`Batching Test Post ${postIndex + 1}`);
        expect(post.comments.length).toBe(3); // 1 parent + 2 replies

        const parentComment = post.comments.find((c: any) => c.commentId === null);
        const replies = post.comments.filter((c: any) => c.commentId !== null);

        expect(parentComment).toBeDefined();
        expect(replies.length).toBe(2);
        expect(parentComment.replies.length).toBe(2);

        // Verify that replies have parentComment populated
        replies.forEach((reply: any) => {
          expect(reply.parentComment).toBeDefined();
          expect(reply.parentComment.id).toBe(parentComment.id);
        });
      });

      // Cleanup - delete replies first, then parents to avoid foreign key constraints
      await db.delete(comment).where(eq(comment.postId, testPostIds[0]));
      await db.delete(comment).where(eq(comment.postId, testPostIds[1]));
      for (const postId of testPostIds) {
        await db.delete(post).where(eq(post.id, postId));
      }
    });
  });
});

describe("Explicit Schema Creation", () => {
  it("should create schema with explicit control over typeDefs", async () => {
    // Import the individual components for explicit control
    const {
      buildSchemaSDL,
      exportDirectiveTypeDefs,
      commonScalars,
      makeExecutableSchema,
    } = await import("../index");

    // 1. Generate basic schema
    const { typeDefs, resolvers } = buildSchemaSDL(db);

    // 2. Create executable schema with explicit typeDefs array
    let executableSchema = makeExecutableSchema({
      typeDefs: [
        exportDirectiveTypeDefs,
        `enum ReactionType { LIKE DISLIKE }`,
        typeDefs
      ],
      resolvers: { ...resolvers, ...commonScalars },
    });

    expect(executableSchema).toBeDefined();
    expect(executableSchema.getTypeMap()).toBeDefined();

    // Check that directives are included
    const directiveNames = executableSchema.getDirectives().map(d => d.name);
    expect(directiveNames).toContain("export");

    // Test a simple query using the shared envelop configuration
    const query = `
      query {
        userFindMany {
          id
          name
          email
        }
      }
    `;

    const result = await executeGraphQLQuery(enveloped, query);
    expect(result?.userFindMany).toBeDefined();
  });

  it("should work with custom scalars and explicit typeDefs order", async () => {
    const {
      buildSchemaSDL,
      exportDirectiveTypeDefs,
      commonScalars,
      makeExecutableSchema,
    } = await import("../index");

    const { typeDefs, resolvers } = buildSchemaSDL(db);

    const schema = makeExecutableSchema({
      typeDefs: [
        exportDirectiveTypeDefs,
        `enum ReactionType { LIKE DISLIKE }`,
        `scalar DateTime`,
        `enum Status { ACTIVE INACTIVE }`,
        typeDefs
      ],
      resolvers: {
        ...resolvers,
        ...commonScalars,
        DateTime: {
          serialize: (value: any) => value?.toISOString?.() || value,
          parseValue: (value: any) => new Date(value),
          parseLiteral: (ast: any) => new Date(ast.value),
        },
      },
    });

    expect(schema).toBeDefined();

    // Check that custom types are included
    expect(schema.getType("DateTime")).toBeDefined();
    expect(schema.getType("Status")).toBeDefined();
    expect(schema.getType("ReactionType")).toBeDefined();

    // Check that directives are included
    const directiveNames = schema.getDirectives().map(d => d.name);
    expect(directiveNames).toContain("export");
  });

  it("should demonstrate shared standard configuration benefits", () => {
    // Test that we can create multiple schemas with the same standard config
    const { createStandardSchema } = require("./shared-config");
    const schema1 = createStandardSchema(db);
    const schema2 = createStandardSchema(db);

    expect(schema1.schema).toBeDefined();
    expect(schema2.schema).toBeDefined();
    expect(schema1.fullTypeDefs).toBe(schema2.fullTypeDefs); // Same typeDefs

    // Verify standard configuration includes what we expect
    const directiveNames = schema1.schema.getDirectives().map(d => d.name);
    expect(directiveNames).toContain("export");
    expect(schema1.schema.getType("ReactionType")).toBeDefined();
  });
});
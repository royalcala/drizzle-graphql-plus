import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { user, post, comment, reaction } from "./schema";
import { ulid as generateUlid } from "ulid";
import { eq } from "drizzle-orm";
import { createSharedEnvelop, executeGraphQLQuery } from "./shared-envelop";

// Minimal repro for libsql "not yet implemented: array" panic
// when using ReactionType filters with inArray/in on reactionFindMany.
// This test intentionally targets the ReactionType field only and does
// NOT use any export directive features.

const client = createClient({
  url: "file:src/build-schema-sdl-with-dl/tests/test-reaction-panic.db",
});

const db = drizzle(client, {
  schema,
  logger: {
    logQuery: (query, params) => {
      console.log("🔍 SQL Query:", query);
      console.log("📋 Parameters:", params);
      console.log("---");
    },
  },
});

const enveloped = createSharedEnvelop(db);

describe("ReactionType inArray filter (libsql panic repro)", () => {
  const ids = {
    userId: generateUlid(),
    postId: generateUlid(),
    commentId: generateUlid(),
    reactionId: generateUlid(),
  };

  beforeAll(async () => {
    await db.insert(user).values({
      id: ids.userId,
      name: "Reaction Panic User",
      email: `reaction-panic-${generateUlid()}@example.com`,
      bio: "User for ReactionType panic repro",
    });

    await db.insert(post).values({
      id: ids.postId,
      title: "Reaction Panic Post",
      content: "Post for ReactionType panic repro",
      authorId: ids.userId,
    });

    await db.insert(comment).values({
      id: ids.commentId,
      text: "Reaction Panic Comment",
      postId: ids.postId,
      userId: ids.userId,
    });

    await db.insert(reaction).values({
      id: ids.reactionId,
      postId: ids.postId,
      commentId: ids.commentId,
      authorId: ids.userId,
      type: "LIKE",
    });
  });

  afterAll(async () => {
    await db.delete(reaction).where(eq(reaction.id, ids.reactionId));
    await db.delete(comment).where(eq(comment.id, ids.commentId));
    await db.delete(post).where(eq(post.id, ids.postId));
    await db.delete(user).where(eq(user.id, ids.userId));
  });

  it("should query reactionFindMany with ReactionType inArray filter", async () => {
    const query = `
      query {
        reactionFindMany(where: { type: { inArray: [LIKE] } }) {
          id
          type
        }
      }
    `;

    const data = await executeGraphQLQuery(enveloped, query);

    expect(data?.reactionFindMany).toBeDefined();
    const reactions = data?.reactionFindMany as any[];
    expect(Array.isArray(reactions)).toBe(true);
    expect(reactions.length).toBeGreaterThan(0);
    reactions.forEach((r) => {
      expect(r.type).toBe("LIKE");
    });
  });

  it("should query reactionFindMany with inArray using variables", async () => {
    const query = `
      query ($types: [ReactionType!]!) {
        reactionFindMany(where: { type: { inArray: $types } }) {
          id
          type
        }
      }
    `;

    const data = await executeGraphQLQuery(enveloped, query, {
      types: ["LIKE"],
    });

    expect(data?.reactionFindMany).toBeDefined();
    const reactions = data?.reactionFindMany as any[];
    expect(Array.isArray(reactions)).toBe(true);
    expect(reactions.length).toBeGreaterThan(0);
    reactions.forEach((r) => {
      expect(r.type).toBe("LIKE");
    });
  });
});

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { ulid as generateUlid } from "ulid";
import { setCustomGraphQLTypes } from "../src/index";

export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid()),
  name: text("name").notNull(),
  email: text("email").notNull(),
  bio: text("bio"),
});

export const post = sqliteTable("post", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid()),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: text("author_id").notNull(),
  name: text("name"),
});

export const comment = sqliteTable("comment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid()),
  text: text("text").notNull(),
  postId: text("post_id").notNull(),
  userId: text("user_id").notNull(),
});

// Mark columns as ULID type for GraphQL
setCustomGraphQLTypes(user, { id: "ULID" });
setCustomGraphQLTypes(post, { id: "ULID", authorId: "ULID" });
setCustomGraphQLTypes(comment, { id: "ULID", postId: "ULID", userId: "ULID" });

export const userRelations = relations(user, ({ many }) => ({
  posts: many(post),
  comments: many(comment),
}));

export const postRelations = relations(post, ({ one, many }) => ({
  author: one(user, {
    fields: [post.authorId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  post: one(post, {
    fields: [comment.postId],
    references: [post.id],
  }),
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
}));

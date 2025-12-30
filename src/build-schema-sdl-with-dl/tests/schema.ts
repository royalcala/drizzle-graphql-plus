import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { ulid as generateUlid } from "ulid";
import { setCustomGraphQL } from "../../../src/index";

export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
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
  authorId: text("author_id")
    .notNull()
    .references(() => user.id),
  name: text("name"),
  cityId: text("city_id").references(() => city.id),
  sportId: text("sport_id").references(() => sport.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const comment = sqliteTable("comment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
  text: text("text").notNull(),
  postId: text("post_id")
    .notNull()
    .references(() => post.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
});

export type ReactionTypes = "LIKE" | "DISLIKE";

export const reaction = sqliteTable("reaction", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
  commentId: text("comment_id")
    .notNull()
    .references(() => comment.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  type: text("type").$type<ReactionTypes>().notNull(),
});

// One-to-one relation: each user has exactly one profile
export const userProfile = sqliteTable("user_profile", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
  userId: text("user_id").notNull().unique(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  website: text("website"),
});

// City table for the sport/city example
export const city = sqliteTable("city", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

// Sport table
export const sport = sqliteTable("sport", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUlid())
    .notNull(),
  name: text("name").notNull(),
});

setCustomGraphQL(reaction, {
  type: {
    type: "ReactionType",
    description: "Type of reaction: LIKE or DISLIKE",
  },
});

export const userRelations = relations(user, ({ one, many }) => ({
  posts: many(post),
  comments: many(comment),
  profile: one(userProfile, {
    fields: [user.id],
    references: [userProfile.userId],
  }),
}));

export const postRelations = relations(post, ({ one, many }) => ({
  author: one(user, {
    fields: [post.authorId],
    references: [user.id],
  }),
  comments: many(comment),
  city: one(city, {
    fields: [post.cityId],
    references: [city.id],
  }),
  sport: one(sport, {
    fields: [post.sportId],
    references: [sport.id],
  }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  post: one(post, {
    fields: [comment.postId],
    references: [post.id],
  }),
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  reactions: many(reaction),
}));

export const reactionRelations = relations(reaction, ({ one }) => ({
  comment: one(comment, {
    fields: [reaction.commentId],
    references: [comment.id],
  }),
  user: one(user, {
    fields: [reaction.userId],
    references: [user.id],
  }),
}));

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, {
    fields: [userProfile.userId],
    references: [user.id],
  }),
}));

export const cityRelations = relations(city, ({ many }) => ({
  posts: many(post),
}));

export const sportRelations = relations(sport, ({ many }) => ({
  posts: many(post),
}));
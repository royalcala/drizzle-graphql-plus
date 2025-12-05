import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const client = createClient({
  url: "file:test-server/test.db",
});

const db = drizzle(client, { schema });

async function seed() {
  console.log("🌱 Seeding database...");
  console.log(
    "ℹ️  Make sure to run 'npx drizzle-kit push' first to create tables"
  );

  // Clear existing data
  console.log("🗑️  Clearing existing data...");
  await db.delete(schema.comment);
  await db.delete(schema.post);
  await db.delete(schema.user);

  // Insert users
  const [user1] = await db
    .insert(schema.user)
    .values({
      name: "Alice Smith",
      email: "alice@example.com",
      bio: "Software developer and GraphQL enthusiast",
    })
    .returning();

  const [user2] = await db
    .insert(schema.user)
    .values({
      name: "Bob Johnson",
      email: "bob@example.com",
      bio: "Backend engineer",
    })
    .returning();

  const [user3] = await db
    .insert(schema.user)
    .values({
      name: "Charlie Brown",
      email: "charlie@example.com",
      bio: null,
    })
    .returning();

  console.log(`✅ Created ${3} users`);

  // Insert posts
  const [post1] = await db
    .insert(schema.post)
    .values({
      title: "Introduction to GraphQL",
      content: "GraphQL is a query language for APIs...",
      authorId: user1!.id,
      name: "Another test name 1",
    })
    .returning();

  const [post2] = await db
    .insert(schema.post)
    .values({
      title: "Drizzle ORM Tutorial",
      content: "Drizzle is a modern TypeScript ORM...",
      authorId: user1!.id,
      name: "Another test name 2",
    })
    .returning();

  const [post3] = await db
    .insert(schema.post)
    .values({
      title: "Building REST APIs",
      content: "REST is an architectural style...",
      authorId: user2!.id,
    })
    .returning();

  console.log(`✅ Created ${3} posts`);

  // Insert comments
  await db.insert(schema.comment).values([
    {
      text: "Great article!",
      postId: post1!.id,
      userId: user2!.id,
    },
    {
      text: "Very informative, thanks for sharing",
      postId: post1!.id,
      userId: user3!.id,
    },
    {
      text: "I learned a lot from this",
      postId: post2!.id,
      userId: user2!.id,
    },
    {
      text: "Could you explain more about relations?",
      postId: post2!.id,
      userId: user3!.id,
    },
    {
      text: "REST vs GraphQL comparison would be nice",
      postId: post3!.id,
      userId: user1!.id,
    },
  ]);

  console.log(`✅ Created ${5} comments`);
  console.log("✨ Database seeded successfully!");

  client.close();
}

seed().catch((error) => {
  console.error("❌ Error seeding database:", error);
  process.exit(1);
});

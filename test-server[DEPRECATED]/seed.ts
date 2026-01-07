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
  await db.delete(schema.reaction);
  await db.delete(schema.comment);
  await db.delete(schema.post);
  await db.delete(schema.userProfile);
  await db.delete(schema.user);
  await db.delete(schema.city);
  await db.delete(schema.sport);

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

  // Insert cities
  const [city1] = await db
    .insert(schema.city)
    .values({
      name: "New York",
      slug: "new-york",
    })
    .returning();

  const [city2] = await db
    .insert(schema.city)
    .values({
      name: "Los Angeles",
      slug: "los-angeles",
    })
    .returning();

  const [city3] = await db
    .insert(schema.city)
    .values({
      name: "Chicago",
      slug: "chicago",
    })
    .returning();

  console.log(`✅ Created ${3} cities`);

  // Insert sports
  const [sport1] = await db
    .insert(schema.sport)
    .values({
      name: "Football",
    })
    .returning();

  const [sport2] = await db
    .insert(schema.sport)
    .values({
      name: "Basketball",
    })
    .returning();

  const [sport3] = await db
    .insert(schema.sport)
    .values({
      name: "Baseball",
    })
    .returning();

  console.log(`✅ Created ${3} sports`);

  // Insert posts
  const [post1] = await db
    .insert(schema.post)
    .values({
      title: "Introduction to GraphQL",
      content: "GraphQL is a query language for APIs...",
      authorId: user1!.id,
      name: "Another test name 1",
      cityId: city1!.id,
      sportId: sport1!.id,
    })
    .returning();

  const [post2] = await db
    .insert(schema.post)
    .values({
      title: "Drizzle ORM Tutorial",
      content: "Drizzle is a modern TypeScript ORM...",
      authorId: user1!.id,
      name: "Another test name 2",
      cityId: city2!.id,
      sportId: sport2!.id,
    })
    .returning();

  const [post3] = await db
    .insert(schema.post)
    .values({
      title: "Building REST APIs",
      content: "REST is an architectural style...",
      authorId: user2!.id,
      cityId: city1!.id,
      sportId: sport1!.id,
    })
    .returning();

  const [post4] = await db
    .insert(schema.post)
    .values({
      title: "Football Game in New York",
      content: "Exciting football match in NYC...",
      authorId: user2!.id,
      cityId: city1!.id,
      sportId: sport1!.id,
    })
    .returning();

  const [post5] = await db
    .insert(schema.post)
    .values({
      title: "Basketball Championship in LA",
      content: "Amazing basketball game in Los Angeles...",
      authorId: user3!.id,
      cityId: city2!.id,
      sportId: sport2!.id,
    })
    .returning();

  console.log(`✅ Created ${5} posts`);

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
    {
      text: "Great football coverage!",
      postId: post4!.id,
      userId: user1!.id,
    },
    {
      text: "Love basketball games in LA",
      postId: post5!.id,
      userId: user2!.id,
    },
  ]);

  console.log(`✅ Created ${7} comments`);
  console.log("✨ Database seeded successfully!");

  client.close();
}

seed().catch((error) => {
  console.error("❌ Error seeding database:", error);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// project root: from src/build-schema-sdl-with-dl/tests -> ../../..
const projectRoot = path.resolve(__dirname, "../../..");

const SCHEMA_PATH = "./src/build-schema-sdl-with-dl/tests/schema.ts";

export function resetSqliteTestDb(dbRelativePath: string): void {
  const fullPath = path.join(projectRoot, dbRelativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function pushSqliteTestDb(dbRelativePath: string): void {
  execSync(
    `npx drizzle-kit push --dialect=sqlite --schema=${SCHEMA_PATH} --url=file:${dbRelativePath}`,
    {
      cwd: projectRoot,
      stdio: "inherit",
    }
  );
}

export function ensureMigratedSqliteTestDb(dbRelativePath: string): void {
  resetSqliteTestDb(dbRelativePath);
  pushSqliteTestDb(dbRelativePath);
}

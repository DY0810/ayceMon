import fs from "node:fs";
import { it, expect } from "vitest";

const files = [
  "lib/supabase/admin.ts",
  "lib/supabase/server.ts",
  "lib/supabase/proxy-session.ts",
  "lib/db/stats.ts",
  "lib/places/resolve.ts",
  "lib/auth/require-user.ts",
];

it.each(files)("%s is marked server-only", (f) => {
  expect(fs.readFileSync(f, "utf8")).toMatch(/^import\s+"server-only";/);
});

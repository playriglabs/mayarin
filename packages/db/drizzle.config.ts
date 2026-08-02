import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mayarr:mayarr@localhost:5432/mayarr",
  },
  strict: true,
  verbose: true,
});

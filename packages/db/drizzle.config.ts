import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mayarin:mayarin@localhost:5433/mayarin",
  },
  strict: true,
  verbose: true,
});

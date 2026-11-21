// Load .env here, not just in the entry files: ESM runs imports before the
// entry's dotenv.config(), and the adapter below reads DATABASE_URL right away.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis;

// Rust-free client (engineType = "client" in schema.prisma): queries run in JS
// through the pg driver, so no native query engine is needed. That's what lets
// this run on Android/Termux, where Prisma ships no engine binary.
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== "production")
  globalForPrisma.prisma = prisma;

export default prisma;

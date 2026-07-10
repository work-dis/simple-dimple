import process from "node:process";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS ?? "30000");
const retryDelayMs = Number(process.env.DB_WAIT_RETRY_MS ?? "1000");

if (!databaseUrl) {
  console.error("DATABASE_URL is required for db:wait");
  process.exit(1);
}

const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  const client = new Client({
    connectionString: databaseUrl
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    console.log("Database is ready.");
    process.exit(0);
  } catch {
    await client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

console.error(`Database did not become ready within ${timeoutMs}ms.`);
process.exit(1);

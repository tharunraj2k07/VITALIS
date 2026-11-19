import dotenv from "dotenv";
import { resolve } from "node:path";
import { createDatabase } from "./database.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
const databasePath = resolve(process.env.DATABASE_PATH ?? "../../data/vitalis.sqlite");
const db = createDatabase(databasePath);
db.close();
console.log(`VITALIS SQLite database seeded at ${databasePath}`);

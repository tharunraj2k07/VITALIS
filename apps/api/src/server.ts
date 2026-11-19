import dotenv from "dotenv";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
const databasePath = resolve(process.env.DATABASE_PATH ?? "../../data/vitalis.sqlite");
const db = createDatabase(databasePath);
const app = createApp(db);
const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`VITALIS API listening on http://localhost:${port}`);
});

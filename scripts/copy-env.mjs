import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, ".env.example");
const destination = resolve(root, ".env");

if (existsSync(destination)) {
  console.log(".env already exists; leaving it unchanged.");
} else {
  copyFileSync(source, destination);
  console.log("Created .env from .env.example.");
}

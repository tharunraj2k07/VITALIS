import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const databasePath = join(tmpdir(), `vitalis-playwright-${randomUUID()}.sqlite`);
const cli = resolve(root, "node_modules", "@playwright", "test", "cli.js");
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, DATABASE_PATH: databasePath },
  stdio: "inherit",
});

function cleanDatabase() {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

child.on("error", (error) => {
  console.error(error);
  cleanDatabase();
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  cleanDatabase();
  process.exitCode = signal ? 1 : code ?? 1;
});

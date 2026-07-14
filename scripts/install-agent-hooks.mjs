import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const hooksPath = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim();
const source = resolve(".githooks/pre-commit");
const destination = resolve(hooksPath, "pre-commit");
if (!existsSync(source)) throw new Error("Tracked pre-commit hook is missing.");
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
chmodSync(destination, 0o755);
console.log(`Installed agent pre-commit hook at ${destination}`);

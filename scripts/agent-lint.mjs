import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const fix = args.has("--fix");
const staged = args.has("--staged");
const explicitFiles = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

function changedFiles() {
  const command = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];
  const changed = execFileSync("git", command, { encoding: "utf8" }).split("\n").filter(Boolean);
  if (staged) return changed;
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  return [...new Set([...changed, ...untracked])];
}

const files = explicitFiles.length > 0 ? explicitFiles : changedFiles();
const errors = [];
const fixed = [];

function hasUnstagedChanges(file) {
  const diff = execFileSync("git", ["diff", "--name-only", "--", file], { encoding: "utf8" }).trim();
  return diff.length > 0;
}

function readContent(file) {
  if (!staged) return readFileSync(resolve(file), "utf8");
  return execFileSync("git", ["show", `:${file}`], { encoding: "utf8" });
}

for (const file of files) {
  if (!file.endsWith(".md") || (!file.startsWith("docs/agent-system/") && !file.startsWith(".agent/"))) continue;
  const path = resolve(file);
  const content = readContent(file);
  const summaryCount = (content.match(/^<!-- agent-summary:/gm) ?? []).length;
  if (summaryCount < 7) errors.push(`${file}: requires seven agent-summary lines (found ${summaryCount})`);
  if (!content.endsWith("\n")) {
    if (!fix) errors.push(`${file}: missing final newline (run pnpm agent:lint:fix)`);
    else if (staged && hasUnstagedChanges(file)) {
      errors.push(`${file}: cannot auto-fix staged file with unstaged changes; stage the intended content first`);
    }
    else {
      writeFileSync(path, `${content}\n`);
      fixed.push(file);
    }
  }
}

if (fixed.length > 0 && staged) execFileSync("git", ["add", "--", ...fixed]);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`agent lint passed (${files.length} changed file${files.length === 1 ? "" : "s"})`);

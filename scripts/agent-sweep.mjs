import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const base = args.includes("--base") ? valueAfter("--base") : "HEAD~10";
const head = args.includes("--head") ? valueAfter("--head") : "HEAD";
if (!base || !head) throw new Error("Use --base <commit> --head <commit>.");

const range = `${base}..${head}`;
const commits = execFileSync("git", ["log", "--oneline", range], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" }).trim();
console.log(`# Agent sweep context: ${range}\n\n## Commits\n${commits || "(none)"}\n\n## Changed files\n${files || "(none)"}`);

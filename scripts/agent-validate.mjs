import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const index = args.indexOf("--scope");
const scope = index >= 0 ? args[index + 1] : "all";
if (!new Set(["all", "web", "api", "docs"]).has(scope)) throw new Error("Use --scope all, web, api, or docs.");

const commands = [["pnpm", ["agent:lint"]]];
if (scope === "all" || scope === "web") commands.push(["pnpm", ["--filter", "@popcorn/web", "typecheck"]]);
if (scope === "all" || scope === "api") commands.push(["pnpm", ["--filter", "@popcorn/api", "typecheck"]]);
for (const [command, commandArgs] of commands) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\nValidation completed for scope: ${scope}`);

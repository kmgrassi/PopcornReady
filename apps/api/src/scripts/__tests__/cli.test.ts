import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const cli = fileURLToPath(new URL("../../../scripts/cli.ts", import.meta.url));

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCli, cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      POPCORN_API_URL: "http://127.0.0.1:9",
    },
  });
}

test("CLI help does not advertise the retired run reject command", () => {
  const result = runCli(["help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run approve --project/);
  assert.doesNotMatch(result.stdout, /run reject|approve\|reject/);
});

test("CLI rejects the retired command locally without making an HTTP request", () => {
  const result = runCli(["run", "reject", "--project", "project", "--run", "run"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: run start\|get\|watch\|approve\|cancel/);
  assert.doesNotMatch(result.stderr, /HTTP|ECONNREFUSED|fetch failed/);
});

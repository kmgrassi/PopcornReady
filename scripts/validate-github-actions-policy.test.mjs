import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function liveYaml(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function pathIgnoreBlocks(workflow) {
  const lines = workflow.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "    paths-ignore:") continue;
    const paths = [];
    for (index += 1; index < lines.length; index += 1) {
      const match = lines[index].match(/^      - "([^"]+)"$/);
      if (!match) {
        index -= 1;
        break;
      }
      paths.push(match[1]);
    }
    blocks.push(paths);
  }
  return blocks;
}

test("Web E2E bounds runner usage without narrowing runtime coverage", () => {
  const workflow = liveYaml(".github/workflows/web-e2e.yml");

  assert.match(
    workflow,
    /  pull_request:\n    paths-ignore:/,
    "pull requests should skip only Markdown and agent-record-only changes",
  );
  assert.match(
    workflow,
    /  push:\n    branches: \[main\]\n    paths-ignore:/,
    "main pushes should skip only Markdown and agent-record-only changes",
  );
  assert.deepEqual(pathIgnoreBlocks(workflow), [
    ["**/*.md", ".agent/**"],
    ["**/*.md", ".agent/**"],
  ]);
  assert.match(
    workflow,
    /concurrency:\n  group: web-e2e-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true/,
  );
  assert.match(
    workflow,
    /jobs:\n  smoke:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15/,
  );
  assert.match(
    workflow,
    /- name: Upload Playwright report\n        if: failure\(\)\n        uses: actions\/upload-artifact@v4/,
  );
  assert.doesNotMatch(workflow, /^\s+paths:/m);
});

test("deployment verification cancels obsolete polling, not database mutations", () => {
  const deploy = liveYaml(".github/workflows/deploy-api.yml");
  assert.match(
    deploy,
    /concurrency:\n  group: railway-production-verify-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/,
  );
  assert.match(
    deploy,
    /node scripts\/verify-production-release\.mjs[\s\S]*--expected "\$GITHUB_SHA"[\s\S]*--web-origin "https:\/\/popcornready\.ai"[\s\S]*--api-origin "https:\/\/popcornready-production\.up\.railway\.app"/,
  );
  assert.doesNotMatch(
    deploy,
    /GITHUB_SHA#|Match by prefix|jq -r '\.commit/,
    "production release verification must require exact full-SHA coherence",
  );
  assert.match(
    deploy,
    /jobs:\n  verify:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    if: github\.ref == 'refs\/heads\/main'\n    steps:/,
  );

  for (const workflowPath of [
    ".github/workflows/supabase-auth-url-config.yml",
    ".github/workflows/supabase-migrations.yml",
  ]) {
    assert.match(
      liveYaml(workflowPath),
      /concurrency:\n  group: [^\n]+\n  cancel-in-progress: false/,
      `${workflowPath} must not cancel a live production mutation`,
    );
  }
});

test("production migrations use a reviewed exact Supabase CLI version", () => {
  const migrations = liveYaml(".github/workflows/supabase-migrations.yml");
  assert.match(
    migrations,
    /uses: supabase\/setup-cli@v1\n\s+with:\n\s+version: 2\.111\.0/,
    "production migrations must use the reviewed Supabase CLI version",
  );
  assert.doesNotMatch(
    migrations,
    /version:\s*(?:latest|beta)\b/,
    "production migrations must not float to an unreviewed Supabase CLI release",
  );
});

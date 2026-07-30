import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectDbRelationSource,
  validateDbRelationSources,
  validateRepositoryDbRelations,
} from "./validate-api-db-relations.mjs";

test("extracts direct, parenthesized, bracket, and conditional relation targets", () => {
  const result = inspectDbRelationSource(`
    db.from("assets").select("*");
    (((db.from)))("projects").select("*");
    db["from"](\`story_panels\`).select("*");
    db.from(flag ? "story_beats" : "story_blueprints").select("*");
  `);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.literalCalls.map((call) => call.target),
    ["assets", "projects", "story_panels", "story_beats", "story_blueprints"]
  );
});

test("ignores non-database Array, Buffer, and storage bucket from calls", () => {
  const result = inspectDbRelationSource(`
    Array.from("storyboards");
    Buffer.from("storyboard_panels");
    client.storage.from(BUCKET).upload("path", bytes);
  `);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.literalCalls, []);
  assert.deepEqual(result.dynamicCalls, []);
});

test("rejects retired relation targets with a named replacement", () => {
  const result = validateDbRelationSources(
    [{
      fileName: "apps/api/src/runtime.ts",
      source: 'db.from("storyboard_panels").select("*");',
    }],
    new Map([["storyboard_panels", "story_panels"]]),
    new Map()
  );
  assert.match(
    result.errors.join("\n"),
    /runtime\.ts:1: retired relation "storyboard_panels".*story_panels/
  );
});

test("rejects unreviewed dynamic targets and database from aliases", () => {
  const dynamic = validateDbRelationSources(
    [{ fileName: "runtime.ts", source: "db.from(table).select('*');" }],
    new Map(),
    new Map()
  );
  assert.match(dynamic.errors.join("\n"), /dynamic database relation target/);

  const alias = inspectDbRelationSource(
    "const queryTable = db.from; queryTable('storyboards');"
  );
  assert.match(alias.errors.join("\n"), /aliases are prohibited/);

  const destructured = inspectDbRelationSource(
    "const { from: queryTable } = db; queryTable('storyboards');"
  );
  assert.match(destructured.errors.join("\n"), /destructuring.*aliases/);

  const obscured = inspectDbRelationSource(
    "db[member]('storyboard_panels').select('*');"
  );
  assert.match(obscured.errors.join("\n"), /conceals retired relation/);
});

test("reviewed dynamic targets are exact-count inventory entries", () => {
  const allowed = new Map([["runtime.ts:table", 1]]);
  const passing = validateDbRelationSources(
    [{ fileName: "runtime.ts", source: "db.from(table).select('*');" }],
    new Map(),
    allowed
  );
  assert.deepEqual(passing.errors, []);

  const missing = validateDbRelationSources([], new Map(), allowed);
  assert.match(missing.errors.join("\n"), /expected 1, found 0/);
});

test("comments and historical strings do not count as runtime calls", () => {
  const result = inspectDbRelationSource(`
    // db.from("storyboards")
    const migrationNote = 'db.from("storyboard_panels")';
  `);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.literalCalls, []);
});

test("repository production sources contain no retired relation targets", () => {
  const result = validateRepositoryDbRelations();
  assert.deepEqual(result.errors, []);
  assert.ok(result.literalCalls.length > 0);
});

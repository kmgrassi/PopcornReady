import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectRpcSource,
  validateRepositoryRpcBoundary,
  validateRpcInventory,
} from "./validate-api-rpc-boundary.mjs";

test("extracts literal, multiline, conditional, and duplicate RPC targets", () => {
  const result = inspectRpcSource(`
    db.rpc("literal", {});
    db.rpc(
      "multiline",
      {}
    );
    db.rpc(flag ? "conditional_a" : "conditional_b", {});
    db.rpc("literal", {});
  `);
  assert.deepEqual(result.errors, []);
  assert.equal(result.expressions, 4);
  assert.deepEqual(result.targets, [
    "literal",
    "multiline",
    "conditional_a",
    "conditional_b",
    "literal",
  ]);
});

test("rejects dynamic RPC targets and NUL-containing source", () => {
  const dynamic = inspectRpcSource("db.rpc(target, {});");
  assert.match(dynamic.errors[0] ?? "", /must be a string literal/);
  const nul = inspectRpcSource(
    `db.rpc("safe", {});${String.fromCharCode(0)}`
  );
  assert.match(nul.errors[0] ?? "", /contains a NUL byte/);
});

test("extracts quoted and template bracket-access RPC calls", () => {
  const result = inspectRpcSource(`
    db["rpc"]("quoted_bracket", {});
    db[\`rpc\`]("template_bracket", {});
  `);
  assert.deepEqual(result.errors, []);
  assert.equal(result.expressions, 2);
  assert.deepEqual(result.targets, ["quoted_bracket", "template_bracket"]);
});

test("extracts nested parenthesized RPC calls", () => {
  const result = inspectRpcSource(`
    (((db.rpc)))("parenthesized", {});
    ((db["rpc"]))("bracket_parenthesized", {});
  `);
  assert.deepEqual(result.errors, []);
  assert.equal(result.expressions, 2);
  assert.deepEqual(result.targets, [
    "parenthesized",
    "bracket_parenthesized",
  ]);
});

test("rejects bound, assigned, bracket, and destructured RPC aliases", () => {
  for (const source of [
    'const rpc = client.rpc.bind(client); rpc("new_workflow", {});',
    'const invoke = client.rpc; invoke("new_workflow", {});',
    'const invoke = client["rpc"]; invoke("new_workflow", {});',
    'const { rpc } = client; rpc("new_workflow", {});',
    'const { rpc: invoke } = client; invoke("new_workflow", {});',
  ]) {
    const result = inspectRpcSource(source);
    assert.match(result.errors.join("\n"), /alias/i);
  }
});

test("rejects dynamic element-access calls that could conceal RPCs", () => {
  const result = inspectRpcSource("db[member](target, {});");
  assert.match(
    result.errors[0] ?? "",
    /dynamic element-access calls are prohibited/
  );
});

test("rejects a target outside the supplied boundary", () => {
  const result = validateRpcInventory(
    [{ fileName: "fixture.ts", source: 'db.rpc("new_workflow", {});' }],
    new Set(["existing_workflow"]),
    new Set()
  );
  assert.ok(
    result.errors.includes("Unexpected production RPC target: new_workflow")
  );
  assert.ok(
    result.errors.includes("Missing production RPC target: existing_workflow")
  );
});

test("repository inventory remains at the reviewed boundary", () => {
  const result = validateRepositoryRpcBoundary();
  assert.deepEqual(result.errors, []);
  assert.equal(result.productionTargets.size, 64);
  assert.equal(result.productionExpressions, 63);
  assert.equal(result.sandboxTargets.size, 1);
  assert.equal(result.sandboxExpressions, 2);
});

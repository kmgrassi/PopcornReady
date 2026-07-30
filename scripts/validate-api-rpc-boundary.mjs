#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiSourceRoot = join(repoRoot, "apps/api/src");

export const PRODUCTION_RPC_TARGETS = new Set([
  "abandon_idempotency_record",
  "allocate_agent_session_sequence",
  "apply_credit_transaction",
  "cancel_domain_run",
  "cancel_orchestrator_run_family",
  "claim_agent_session_run",
  "claim_expired_anonymous_projects",
  "claim_job_recovery",
  "claim_orchestrator_dispatches",
  "claim_provider_job_execution",
  "claim_purgeable_anonymous_users",
  "complete_idempotency_record",
  "complete_provider_job_execution",
  "create_creator_direct_proposal_gate_with_id",
  "create_domain_run_dispatch",
  "create_domain_run_dispatch_batch",
  "create_orchestrator_run_with_anonymous_quota",
  "current_app_user_id",
  "downstream_assets",
  "fail_domain_run_turn",
  "finalize_domain_run_turn",
  "mint_audio_asset_version",
  "owner_tier",
  "project_manifest",
  "purge_anonymous_user_rows",
  "purge_expired_anonymous_projects",
  "record_orchestrator_budget_billing",
  "recover_anonymous_workspace",
  "recover_orchestrator_runtime_controls",
  "regenerate_asset_version",
  "regenerate_asset_version_pooled",
  "release_agent_session_run",
  "release_orchestrator_dispatch",
  "release_orchestrator_run_budget",
  "renew_idempotency_record",
  "renew_provider_job_execution",
  "reserve_idempotency_record",
  "reserve_orchestrator_run_budget",
  "search_project_asset_embeddings",
  "search_public_asset_embeddings",
  "search_public_assets",
  "search_public_catalog_entries",
  "search_public_projects",
  "search_storyboard_chunks",
  "select_empty_project_poster_from_first_frame",
  "settle_orchestrator_run_budget",
  "update_active_job",
  "wake_orchestrator_dispatch",
]);

export const SANDBOX_RPC_TARGETS = new Set(["delete_test_sandbox"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".d.ts") ||
      path.split(/[\\/]/).includes("__tests__")
    ) {
      return [];
    }
    return [path];
  });
}

function literalTargets(expression) {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }
  if (ts.isParenthesizedExpression(expression)) {
    return literalTargets(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = literalTargets(expression.whenTrue);
    const whenFalse = literalTargets(expression.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

function unwrapParentheses(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isStaticRpcMember(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "rpc";
  }
  if (ts.isElementAccessExpression(node)) {
    const members = node.argumentExpression
      ? literalTargets(node.argumentExpression)
      : null;
    return members?.includes("rpc") ?? false;
  }
  return false;
}

function isDirectCallCallee(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return (
    ts.isCallExpression(current.parent) &&
    current.parent.expression === current
  );
}

function bindingKey(node) {
  const key = node.propertyName ?? node.name;
  if (
    ts.isIdentifier(key) ||
    ts.isStringLiteral(key) ||
    ts.isNoSubstitutionTemplateLiteral(key)
  ) {
    return key.text;
  }
  return null;
}

export function inspectRpcSource(source, fileName = "fixture.ts") {
  const errors = [];
  const targets = [];
  let expressions = 0;
  if (source.includes("\0")) {
    errors.push(`${fileName}: contains a NUL byte`);
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function visit(node) {
    if (
      isStaticRpcMember(node) &&
      !isDirectCallCallee(node)
    ) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push(
        `${fileName}:${location.line + 1}: RPC members may only be used as direct call callees; aliases are prohibited`
      );
    }
    if (ts.isBindingElement(node) && bindingKey(node) === "rpc") {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push(
        `${fileName}:${location.line + 1}: destructuring RPC aliases is prohibited`
      );
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapParentheses(node.expression);
      if (ts.isIdentifier(callee) && callee.text === "rpc") {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        );
        errors.push(
          `${fileName}:${location.line + 1}: aliased RPC calls are prohibited`
        );
      }
      let isRpcCall =
        isStaticRpcMember(callee);
      if (ts.isElementAccessExpression(callee)) {
        const members = callee.argumentExpression
          ? literalTargets(callee.argumentExpression)
          : null;
        if (!members) {
          const location = sourceFile.getLineAndCharacterOfPosition(
            node.getStart()
          );
          errors.push(
            `${fileName}:${location.line + 1}: dynamic element-access calls are prohibited because they can conceal RPC targets`
          );
        } else {
          isRpcCall = members.includes("rpc");
        }
      }
      if (!isRpcCall) {
        ts.forEachChild(node, visit);
        return;
      }
      expressions += 1;
      const extracted = node.arguments[0]
        ? literalTargets(node.arguments[0])
        : null;
      if (!extracted) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        errors.push(
          `${fileName}:${location.line + 1}: RPC target must be a string literal or literal conditional`
        );
      } else {
        targets.push(...extracted);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { errors, expressions, targets };
}

export function validateRpcInventory(
  sources,
  expectedProduction = PRODUCTION_RPC_TARGETS,
  expectedSandbox = SANDBOX_RPC_TARGETS
) {
  const errors = [];
  const productionTargets = new Set();
  const sandboxTargets = new Set();
  let productionExpressions = 0;
  let sandboxExpressions = 0;

  for (const { fileName, source, sandbox = false } of sources) {
    const result = inspectRpcSource(source, fileName);
    errors.push(...result.errors);
    const targetSet = sandbox ? sandboxTargets : productionTargets;
    result.targets.forEach((target) => targetSet.add(target));
    if (sandbox) sandboxExpressions += result.expressions;
    else productionExpressions += result.expressions;
  }

  for (const [label, actual, expected] of [
    ["production", productionTargets, expectedProduction],
    ["sandbox", sandboxTargets, expectedSandbox],
  ]) {
    for (const target of actual) {
      if (!expected.has(target)) errors.push(`Unexpected ${label} RPC target: ${target}`);
    }
    for (const target of expected) {
      if (!actual.has(target)) errors.push(`Missing ${label} RPC target: ${target}`);
    }
  }

  return {
    errors,
    productionExpressions,
    productionTargets,
    sandboxExpressions,
    sandboxTargets,
  };
}

export function validateRepositoryRpcBoundary() {
  const sources = sourceFiles(apiSourceRoot).map((path) => ({
    fileName: relative(repoRoot, path),
    source: readFileSync(path, "utf8"),
    sandbox: path
      .split(/[\\/]/)
      .join("/")
      .includes("/lib/test-sandboxes/"),
  }));
  const result = validateRpcInventory(sources);
  if (result.productionExpressions !== 47) {
    result.errors.push(
      `Expected 47 production RPC expressions, found ${result.productionExpressions}`
    );
  }
  if (result.sandboxExpressions !== 2) {
    result.errors.push(
      `Expected 2 sandbox RPC expressions, found ${result.sandboxExpressions}`
    );
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateRepositoryRpcBoundary();
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(
    `API RPC boundary valid: ${result.productionTargets.size} production targets / ` +
      `${result.productionExpressions} expressions; ${result.sandboxTargets.size} sandbox target / ` +
      `${result.sandboxExpressions} expressions`
  );
}

#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiSourceRoot = join(repoRoot, "apps/api/src");

/**
 * Relations explicitly retired by destructive migrations. Runtime callers must
 * move to the replacement model rather than restoring these surfaces.
 */
export const RETIRED_RELATIONS = new Map([
  ["brief_versions", "assets(kind='brief')"],
  ["compositions", "assets(kind='composite')"],
  ["edit_graphs", "asset graph actions and selections"],
  ["generation_runs", "orchestrator_runs"],
  ["generation_stage_artifacts", "assets and actions"],
  ["generation_stage_items", "actions and jobs"],
  ["generation_stages", "actions and jobs"],
  ["storyboard_beats", "story_beats"],
  ["storyboard_panels", "story_panels"],
  ["storyboard_scenes", "story_blueprint_scenes"],
  ["storyboards", "story_blueprints"],
  ["timelines", "assets(kind='composite')"],
]);

/** Production relation targets must be statically enumerable. */
export const REVIEWED_DYNAMIC_FROM_CALLS = new Map();

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
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function fromMember(node) {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "from") return node;
  if (ts.isElementAccessExpression(node)) {
    const members = node.argumentExpression
      ? literalTargets(node.argumentExpression)
      : null;
    if (members?.includes("from")) return node;
  }
  return null;
}

function memberOwner(member) {
  return unwrapParentheses(member.expression);
}

function isNonDatabaseFrom(member) {
  const owner = memberOwner(member);
  if (
    ts.isIdentifier(owner) &&
    new Set(["Array", "Buffer"]).has(owner.text)
  ) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "storage"
  );
}

function isDirectCallCallee(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return ts.isCallExpression(current.parent) && current.parent.expression === current;
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

export function inspectDbRelationSource(source, fileName = "fixture.ts") {
  const errors = [];
  const literalCalls = [];
  const dynamicCalls = [];
  if (source.includes("\0")) errors.push(`${fileName}: contains a NUL byte`);
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function location(node) {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return `${fileName}:${start.line + 1}`;
  }

  function visit(node) {
    if (ts.isBindingElement(node) && bindingKey(node) === "from") {
      errors.push(
        `${location(node)}: destructuring database .from aliases is prohibited`
      );
    }
    const member = fromMember(node);
    if (member && !isNonDatabaseFrom(member) && !isDirectCallCallee(member)) {
      errors.push(
        `${location(member)}: database .from aliases are prohibited because they conceal relation targets`
      );
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapParentheses(node.expression);
      if (
        ts.isElementAccessExpression(callee) &&
        callee.argumentExpression &&
        !literalTargets(callee.argumentExpression)
      ) {
        const obscuredTargets = node.arguments[0]
          ? literalTargets(node.arguments[0])
          : null;
        for (const target of obscuredTargets ?? []) {
          if (RETIRED_RELATIONS.has(target)) {
            errors.push(
              `${location(node)}: dynamic element-access call conceals retired relation "${target}"`
            );
          }
        }
      }
      const directMember = fromMember(callee);
      if (directMember && !isNonDatabaseFrom(directMember)) {
        const targetExpression = node.arguments[0];
        const targets = targetExpression ? literalTargets(targetExpression) : null;
        if (targets) {
          for (const target of targets) {
            literalCalls.push({
              fileName,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              target,
            });
          }
        } else {
          dynamicCalls.push({
            fileName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            expression: targetExpression?.getText(sourceFile) ?? "<missing>",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { errors, literalCalls, dynamicCalls };
}

export function validateDbRelationSources(
  sources,
  retiredRelations = RETIRED_RELATIONS,
  reviewedDynamicCalls = REVIEWED_DYNAMIC_FROM_CALLS
) {
  const errors = [];
  const literalCalls = [];
  const dynamicCalls = [];
  const dynamicCounts = new Map();

  for (const { fileName, source } of sources) {
    const result = inspectDbRelationSource(source, fileName);
    errors.push(...result.errors);
    literalCalls.push(...result.literalCalls);
    dynamicCalls.push(...result.dynamicCalls);
  }

  for (const call of literalCalls) {
    const replacement = retiredRelations.get(call.target);
    if (replacement) {
      errors.push(
        `${call.fileName}:${call.line}: retired relation "${call.target}" is prohibited; use ${replacement}`
      );
    }
  }

  for (const call of dynamicCalls) {
    const key = `${call.fileName}:${call.expression}`;
    dynamicCounts.set(key, (dynamicCounts.get(key) ?? 0) + 1);
    if (!reviewedDynamicCalls.has(key)) {
      errors.push(
        `${call.fileName}:${call.line}: dynamic database relation target "${call.expression}" is not reviewed`
      );
    }
  }
  for (const [key, expectedCount] of reviewedDynamicCalls) {
    const actualCount = dynamicCounts.get(key) ?? 0;
    if (actualCount !== expectedCount) {
      errors.push(
        `Reviewed dynamic database relation call "${key}" expected ${expectedCount}, found ${actualCount}`
      );
    }
  }

  return { errors, literalCalls, dynamicCalls };
}

export function validateRepositoryDbRelations() {
  const sources = sourceFiles(apiSourceRoot).map((path) => ({
    fileName: relative(repoRoot, path),
    source: readFileSync(path, "utf8"),
  }));
  return validateDbRelationSources(sources);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateRepositoryDbRelations();
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(
    `API database relation boundary valid: ${result.literalCalls.length} literal calls; ` +
      `${result.dynamicCalls.length} reviewed dynamic calls; no retired relations`
  );
}

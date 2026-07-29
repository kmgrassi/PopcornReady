import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const migrationNamePattern = /^(\d{14})_.+\.sql$/;
const defaultMigrationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../supabase/migrations"
);

export function validateMigrationFileNames(fileNames) {
  const sqlFiles = fileNames.filter((fileName) => fileName.endsWith(".sql")).sort();
  const malformed = [];
  const filesByVersion = new Map();

  for (const fileName of sqlFiles) {
    const match = migrationNamePattern.exec(fileName);
    if (!match) {
      malformed.push(fileName);
      continue;
    }
    const version = match[1];
    const versionFiles = filesByVersion.get(version) ?? [];
    versionFiles.push(fileName);
    filesByVersion.set(version, versionFiles);
  }

  const duplicates = [...filesByVersion.entries()]
    .filter(([, versionFiles]) => versionFiles.length > 1)
    .map(([version, versionFiles]) => ({ version, files: versionFiles.sort() }))
    .sort((left, right) => left.version.localeCompare(right.version));

  return { malformed, duplicates, sqlFileCount: sqlFiles.length };
}

export async function validateMigrationDirectory(directory = defaultMigrationDirectory) {
  return validateMigrationFileNames(await readdir(directory));
}

function formatErrors(result) {
  const lines = [];
  if (result.malformed.length > 0) {
    lines.push("Invalid Supabase migration filenames (expected 14 digits, underscore, name.sql):");
    for (const fileName of result.malformed) lines.push(`- ${fileName}`);
  }
  if (result.duplicates.length > 0) {
    lines.push("Duplicate Supabase migration versions:");
    for (const duplicate of result.duplicates) {
      lines.push(`- ${duplicate.version}: ${duplicate.files.join(", ")}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const directory = process.argv[2] ? resolve(process.argv[2]) : defaultMigrationDirectory;
  const result = await validateMigrationDirectory(directory);
  const errors = formatErrors(result);
  if (errors) {
    console.error(errors);
    process.exitCode = 1;
    return;
  }
  console.log(`Supabase migration validation passed (${result.sqlFileCount} migrations)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();

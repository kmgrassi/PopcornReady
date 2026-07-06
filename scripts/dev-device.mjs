#!/usr/bin/env node
import { mkdirSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const certDir = path.join(repoRoot, ".local", "device-certs");
const certPath = path.join(certDir, "popcorn-device-cert.pem");
const keyPath = path.join(certDir, "popcorn-device-key.pem");
const port = process.env.POPCORN_DEVICE_PORT || process.env.PORT || "3000";

function findLanAddress() {
  const interfaces = networkInterfaces();
  const addresses = Object.entries(interfaces).flatMap(([name, values = []]) =>
    values
      .filter((value) => value.family === "IPv4" && !value.internal)
      .map((value) => ({ name, address: value.address })),
  );

  return (
    addresses.find(({ name }) => name === "en0")?.address ||
    addresses.find(({ name }) => name === "en1")?.address ||
    addresses[0]?.address
  );
}

function requireCommand(command, installHint) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.status !== 0) {
    console.error(`Missing required command: ${command}`);
    console.error(installHint);
    process.exit(1);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const lanAddress = findLanAddress();
if (!lanAddress) {
  console.error("Could not find a LAN IPv4 address. Connect to Wi-Fi and try again.");
  process.exit(1);
}

requireCommand("mkcert", "Install it with: brew install mkcert nss");

mkdirSync(certDir, { recursive: true });
if (!existsSync(certPath) || !existsSync(keyPath)) {
  console.log("Creating trusted local HTTPS certificate with mkcert...");
  run("mkcert", ["-install"]);
  run("mkcert", [
    "-cert-file",
    certPath,
    "-key-file",
    keyPath,
    "localhost",
    "127.0.0.1",
    "::1",
    lanAddress,
  ]);
}

const caRoot = spawnSync("mkcert", ["-CAROOT"], {
  cwd: repoRoot,
  encoding: "utf8",
});
const caRootPath = caRoot.status === 0 ? caRoot.stdout.trim() : "";

console.log("");
console.log(`Starting Popcorn Ready for device testing: https://${lanAddress}:${port}`);
console.log("Keep the phone and this Mac on the same Wi-Fi network.");
if (caRootPath) {
  console.log(`If the phone does not trust the page yet, install and trust: ${path.join(caRootPath, "rootCA.pem")}`);
}
console.log("");

const child = spawn(
  "pnpm",
  [
    "--filter",
    "@popcorn/web",
    "exec",
    "vite",
    "--host",
    "0.0.0.0",
    "--port",
    port,
    "--strictPort",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      POPCORN_DEVICE_HTTPS_CERT: certPath,
      POPCORN_DEVICE_HTTPS_KEY: keyPath,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});

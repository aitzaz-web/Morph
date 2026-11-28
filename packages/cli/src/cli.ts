#!/usr/bin/env tsx
// morph: the command-line tool companies run from their repo or CI.
//
//   morph push <manifest.ts> [--surface dashboard]
//       Uploads a surface's manifest (components, data, rules, default page). Needs MORPH_URL and
//       MORPH_SECRET_KEY. Run it on every deploy, so Morph always knows your current components.
//   morph check <manifest.ts>
//       Checks the manifest locally without uploading it.
//   morph admin create-tenant --name <name> [--origin <url>]...
//       For Morph operators: registers a company and prints its secret key. Needs MORPH_ADMIN_KEY.
//   morph admin set-origins <tenantId> --origin <url>...
//       For Morph operators: replaces the origins a company's pages may call Morph from.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest, type Manifest } from "@morph/shared";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function fail(message: string): never {
  console.error(`morph: ${message}`);
  process.exit(1);
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} isn't set.`);
  return v;
}

async function loadManifest(path: string | undefined): Promise<Manifest> {
  if (!path) fail("give the path to your manifest, e.g. morph push morph.manifest.ts");
  const mod = await import(pathToFileURL(resolve(path)).href);
  const manifest = (mod.default ?? mod.manifest) as Manifest;
  const problems = validateManifest(manifest);
  if (problems.length) fail(`the manifest isn't valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return manifest;
}

async function call(method: string, path: string, key: string, body?: unknown) {
  const base = env("MORPH_URL").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; problems?: string[] };
  if (!res.ok) fail(`${json.error ?? `request failed (${res.status})`}${json.problems ? `\n${json.problems.map((p) => `  - ${p}`).join("\n")}` : ""}`);
  return json;
}

const [cmd, sub] = positional;

if (cmd === "push") {
  const manifest = await loadManifest(positional[1]);
  const surface = flag("surface") ?? "dashboard";
  const r = await call("PUT", `/v1/surfaces/${surface}`, env("MORPH_SECRET_KEY"), { manifest });
  console.log(`Pushed surface "${surface}" (version ${r.version}).`);
} else if (cmd === "check") {
  await loadManifest(positional[1]);
  console.log("The manifest looks valid. (The default page is checked by Morph when you push.)");
} else if (cmd === "admin" && sub === "create-tenant") {
  const name = flag("name") ?? fail("--name is required.");
  const r = await call("POST", "/v1/admin/tenants", env("MORPH_ADMIN_KEY"), { name, allowedOrigins: flags("origin") });
  console.log(`Created ${name}.\n  tenant id:  ${r.tenantId}\n  secret key: ${r.secretKey}\n  origins:    ${(r.allowedOrigins as string[]).join(", ") || "(none)"}`);
  console.log("Store the secret key on the company's server (MORPH_SECRET_KEY). It won't be shown again.");
} else if (cmd === "admin" && sub === "set-origins") {
  const id = positional[2] ?? fail("give the tenant id.");
  const r = await call("PATCH", `/v1/admin/tenants/${id}`, env("MORPH_ADMIN_KEY"), { allowedOrigins: flags("origin") });
  console.log(`Origins for ${id}: ${(r.allowedOrigins as string[]).join(", ") || "(none)"}`);
} else {
  console.log(`Usage:
  morph push <manifest.ts> [--surface dashboard]      (MORPH_URL, MORPH_SECRET_KEY)
  morph check <manifest.ts>
  morph admin create-tenant --name <name> [--origin <url>]...   (MORPH_URL, MORPH_ADMIN_KEY)
  morph admin set-origins <tenantId> --origin <url>...`);
  if (cmd) process.exit(1);
}

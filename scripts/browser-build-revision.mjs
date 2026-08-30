import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function executableAssetPaths(entryHtml) {
  return [...new Set(
    [...String(entryHtml).matchAll(/(?:href|src)="((?:spatial|input|tokens|vendor\/)[^"]+)"/g)]
      .map((match) => new URL(match[1], "https://local.invalid/").pathname.slice(1))
  )].sort();
}

export async function contentBuildRevision(root, entryHtml) {
  const digest = crypto.createHash("sha256");
  for (const asset of executableAssetPaths(entryHtml)) {
    digest.update(`${asset}\0`);
    digest.update(await fs.readFile(path.join(root, asset)));
    digest.update("\0");
  }
  return `sha256-${digest.digest("hex").slice(0, 16)}`;
}

export function stampEntryHtml(entryHtml, revision) {
  return entryHtml
    .replace(/data-build="[^"]+"/u, `data-build="${revision}"`)
    .replace(/([?&]v=)[^"'&]+/gu, `$1${revision}`);
}

export async function stampBrowserEntryRevision(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const entryFile = path.join(root, options.entryFile || "index.html");
  const entryHtml = await fs.readFile(entryFile, "utf8");
  const revision = await contentBuildRevision(root, entryHtml);
  const stampedEntryHtml = stampEntryHtml(entryHtml, revision);
  const changed = stampedEntryHtml !== entryHtml;
  if (changed) await fs.writeFile(entryFile, stampedEntryHtml, "utf8");
  return Object.freeze({ revision, changed });
}

import { build } from "esbuild";
import crypto from "node:crypto";
import fs from "node:fs/promises";

await build({
  entryPoints: ["src/spatial-markdown-editor.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  outfile: "vendor/spatial-markdown-editor.bundle.js",
  legalComments: "eof",
  minify: true,
  sourcemap: false
});

await build({
  entryPoints: ["src/atom-system/browser-entry.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  outfile: "vendor/atom-spatial-scene.bundle.js",
  legalComments: "eof",
  minify: true,
  sourcemap: false
});

const entryFile = "index.html";
const entryHtml = await fs.readFile(entryFile, "utf8");
// Stamp only after every tracked bundle is final, otherwise the build would
// invalidate its own content revision later in this process.
const executableAssets = [...new Set(
  [...entryHtml.matchAll(/(?:href|src)="((?:spatial|input|tokens|vendor\/)[^"]+)"/g)]
    .map((match) => new URL(match[1], "https://local.invalid/").pathname.slice(1))
)].sort();
const digest = crypto.createHash("sha256");
for (const asset of executableAssets) {
  digest.update(`${asset}\0`);
  digest.update(await fs.readFile(asset));
  digest.update("\0");
}
const browserBuildRevision = `sha256-${digest.digest("hex").slice(0, 16)}`;
const stampedEntryHtml = entryHtml
  .replace(/data-build="[^"]+"/u, `data-build="${browserBuildRevision}"`)
  .replace(/([?&]v=)[^"'&]+/gu, `$1${browserBuildRevision}`);
if (stampedEntryHtml !== entryHtml) {
  await fs.writeFile(entryFile, stampedEntryHtml, "utf8");
}

import { build } from "esbuild";

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

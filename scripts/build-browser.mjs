import { build } from "esbuild";
import { stampBrowserEntryRevision } from "./browser-build-revision.mjs";

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

// Stamp only after every tracked bundle is final, otherwise the build would
// invalidate its own content revision later in this process.
await stampBrowserEntryRevision();

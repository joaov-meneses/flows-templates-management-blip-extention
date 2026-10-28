import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
// An independent, stable entry lets older tabs finish confirmation without reloading drafts.
await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: resolve(root, "dist/client"),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(root, "src/lib/portalAlertCompat.ts"),
      formats: ["es"],
      fileName: () => "assets/portal-alert-compat-v1.js",
    },
  },
});

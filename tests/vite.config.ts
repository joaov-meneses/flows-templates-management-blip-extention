import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL(".vite", import.meta.url)),
  plugins: [
    react(),
    {
      name: "error-page-fixture",
      configureServer(server) {
        server.middlewares.use("/error.html", async (_request, response, next) => {
          try {
            const { renderErrorPage } = await server.ssrLoadModule("../src/lib/error-page.ts");
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(renderErrorPage());
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 8081, strictPort: true },
});

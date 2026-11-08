// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// In production the /api/parent-redeem route is served by Vercel out of api/.
// In local `vite dev` there's no Vercel runtime, so we mount the same handler
// as a connect middleware and dev calls /api/parent-redeem exactly the same
// way. Zero client-bundle contamination because the handler is imported only
// on the server (inside the middleware).
const DEV_API = ["parent-redeem", "activate"];
function apiParentRedeemDev(): Plugin {
  return {
    name: "pulse-dev:api-parent-redeem",
    apply: "serve",
    configureServer(server) {
      for (const name of DEV_API) {
        server.middlewares.use(`/api/${name}`, async (req, res, next) => {
          try {
            const mod = await server.ssrLoadModule(`/api/${name}.js`);
            await mod.default(req, res);
          } catch (e) {
            // Fall through to whatever else might handle it.
            next(e);
          }
        });
      }
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [apiParentRedeemDev()],
  },
});

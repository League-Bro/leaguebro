import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

/** This file runs in Node (cf, Vite); the Worker's own code doesn't get `process`. */
declare const process: { env: Record<string, string | undefined> };

export default defineConfig(({ mode }) => ({
  worker: {
    name: "leaguebro-feedback",
    entrypoint,
    compatibilityDate: "2026-10-01",
    env: {
      /** Every report the app sends (table made by the Worker on first use). */
      DB: bindings.d1({ name: "leaguebro-feedback" }),
      /** Password for the inbox page, shared by the devs. */
      ADMIN_PASSWORD: bindings.secret(),
      /** Fine-grained GitHub token, Issues: read and write on doliaro/leaguebro only. */
      GITHUB_TOKEN: bindings.secret(),
      /** Where issues are made. `GITHUB_API=http://localhost:8798 npm run dev` points a local run at a fake; deploys (production mode) always use GitHub. */
      GITHUB_API: bindings.text((mode === "development" && process.env["GITHUB_API"]) || "https://api.github.com"),
    },
  },
}));

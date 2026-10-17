import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
    // Node server output (.output/server/index.mjs) for the Cloud Run image; NITRO_PRESET overrides it.
    nitro({ preset: process.env.NITRO_PRESET ?? "node-server" }),
  ],
});

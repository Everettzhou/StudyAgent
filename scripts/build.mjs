import { build } from "esbuild";
await build({
  entryPoints: ["server/desktop.ts", "server/cli.ts"],
  outdir: "dist-server",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
});

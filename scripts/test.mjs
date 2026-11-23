import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/reader.test.ts", "tests/completion.test.ts", "tests/workspace.test.ts", "tests/core.test.ts", "tests/integration.test.ts", "tests/timetable.test.ts", "tests/math.test.ts", "tests/selection.test.ts", "tests/reminders.test.ts", "tests/papers.test.ts", "tests/practice.test.ts", "tests/personal-memory.test.ts"],
  outdir: "test-results/compiled",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--test",
    "test-results/compiled/reader.test.cjs",
    "test-results/compiled/completion.test.cjs",
    "test-results/compiled/workspace.test.cjs",
    "test-results/compiled/core.test.cjs",
    "test-results/compiled/integration.test.cjs",
    "test-results/compiled/timetable.test.cjs",
    "test-results/compiled/math.test.cjs",
    "test-results/compiled/selection.test.cjs",
    "test-results/compiled/reminders.test.cjs",
    "test-results/compiled/papers.test.cjs",
    "test-results/compiled/practice.test.cjs",
    "test-results/compiled/personal-memory.test.cjs",
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exit(r.status ?? 1);

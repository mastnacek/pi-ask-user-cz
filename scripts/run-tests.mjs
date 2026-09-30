/**
 * Test runner: bundle the TypeScript tests with the repo's hoisted esbuild, then hand
 * the result to `node --test`.
 *
 * Why not vitest: it is not a dependency of this package, and the only copy on the
 * machine belongs to another plugin's own `node_modules`. esbuild is already hoisted
 * in the parent `plugins/` workspace, so the runner adds no dependency and no install
 * step. Bundling also sidesteps the `.js`-specifier-to-`.ts`-file mapping the source
 * uses internally, which Node's type stripping does not do on its own.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "pi-ask-user-cz-test-"));

try {
	await build({
		entryPoints: [join(root, "translate-blocks.test.ts")],
		outfile: join(outDir, "translate-blocks.test.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		// node: builtins only; anything else would be a real missing dependency.
		external: ["node:*", "@earendil-works/*"],
		logLevel: "warning",
	});
	const bundle = join(outDir, "translate-blocks.test.mjs");
	const result = spawnSync(process.execPath, ["--test", bundle], { stdio: "inherit" });
	process.exit(result.status ?? 1);
} finally {
	rmSync(outDir, { recursive: true, force: true });
}

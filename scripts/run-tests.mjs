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

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "pi-ask-user-cz-test-"));

// Discovered, not listed: a new test/*.test.ts is picked up by `npm test` without
// anyone editing this file, which is the only way the suite keeps covering the
// files it is supposed to.
const testDir = join(root, "test");
const entries = readdirSync(testDir)
	.filter((f) => f.endsWith(".test.ts"))
	.sort()
	.map((f) => join(testDir, f));

if (entries.length === 0) throw new Error(`no *.test.ts found in ${testDir}`);

try {
	const outfiles = [];
	for (const [i, entry] of entries.entries()) {
		const outfile = join(outDir, `${i}-${basename(entry).replace(/\.ts$/, ".mjs")}`);
		outfiles.push(outfile);
		await build({
			entryPoints: [entry],
			outfile,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node22",
			// node: builtins only; anything else would be a real missing dependency.
			external: ["node:*", "@earidil-works/*"],
			logLevel: "warning",
		});
	}
	const result = spawnSync(process.execPath, ["--test", ...outfiles], { stdio: "inherit" });
	process.exit(result.status ?? 1);
} finally {
	rmSync(outDir, { recursive: true, force: true });
}

#!/usr/bin/env node

/**
 * Build a distributable "patch" .vsix from the current working tree.
 *
 * WHY THIS EXISTS
 * ---------------
 * VS Code has no notion of a runtime patch for an installed extension: an
 * extension is an opaque bundle keyed by `publisher.name`, and the Marketplace
 * only ever serves whole versions of that ID. So "upgrade someone to my local
 * change" cannot be a delta — it has to be a complete, installable build of
 * the extension that includes the change.
 *
 * This script produces exactly that, as a *patch channel* build:
 *
 *   - Identity is KEPT (`saoudrizwan.claude-dev` by default) so installing the
 *     result over an existing official Cline is a normal in-place upgrade. We
 *     only bump the version, because VS Code refuses to install a VSIX whose
 *     version is <= the installed one.
 *   - Version is stamped onto a dedicated patch line that always sorts ABOVE
 *     the base version (4.1.21 -> 4.2.1, 4.2.2, ...), because VS Code refuses
 *     to install a VSIX whose version is <= the installed one. See
 *     computePatchVersion for the exact ordering rule.
 *   - The artifact filename keeps the BASE version plus a patch revision
 *     (`cline-patch-4-1-23-r1.vsix`) so a folder of patches stays readable.
 *   - displayName/description/README get a "(Patch)" marker so anyone looking
 *     at the extension list can tell a patched build from a clean one.
 *
 * The build itself is NOT performed here — run `bun run package` first, or
 * pass --build to have this script shell out. We deliberately package with
 * `--no-dependencies` and the already-built `dist/extension.js` +
 * `webview-ui/build/`, exactly like the release workflows, so packaging never
 * re-runs a long build under vsce.
 *
 * Usage:
 *   node scripts/package-patch.mjs                 # package current build
 *   node scripts/package-patch.mjs --build         # run the build first
 *   node scripts/package-patch.mjs --revision 2
 *   node scripts/package-patch.mjs --version 4.1.2102
 *   node scripts/package-patch.mjs --out dist/cline-patch.vsix
 *   node scripts/package-patch.mjs --identity myname.claude-dev
 *
 * Notes:
 *   - `--identity` lets you ship the patch under your own publisher ID. That
 *     installs ALONGSIDE official Cline instead of replacing it, which helps
 *     when you don't control the target machines — but both extensions then
 *     share global storage under ~/.cline, so running two at once is not
 *     supported.
 *   - This script never contacts the Marketplace. It only writes a .vsix file.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")

const packageJsonPath = path.join(projectRoot, "package.json")
const distDir = path.join(projectRoot, "dist")
const extensionBundle = path.join(distDir, "extension.js")
const webviewBuild = path.join(projectRoot, "webview-ui", "build", "index.html")

const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
}

const log = {
	info: (msg) => console.log(`${colors.green}[INFO]${colors.reset} ${msg}`),
	warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
	error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
	step: (msg) => console.log(`${colors.cyan}[STEP]${colors.reset} ${msg}`),
}

/** Parse `--flag value` / `--flag=value` / bare `--flag` into an object. */
function parseArgs(argv) {
	const args = {}
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]
		if (!token.startsWith("--")) {
			continue
		}
		const eq = token.indexOf("=")
		if (eq !== -1) {
			args[token.slice(2, eq)] = token.slice(eq + 1)
			continue
		}
		const key = token.slice(2)
		const next = argv[i + 1]
		if (next !== undefined && !next.startsWith("--")) {
			args[key] = next
			i++
		} else {
			args[key] = true
		}
	}
	return args
}

/** Write JSON the way the rest of the repo does, so diffs stay readable. */
function writeJson(file, value) {
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

const manifestBackupPath = path.join(projectRoot, "package.json.patchbak")
const readmePath = path.join(projectRoot, "README.md")
const marketplaceReadmePath = path.join(projectRoot, "README.marketplace.md")
// Sidecar backup of the ORIGINAL README.md, mirroring manifestBackupPath. It
// exists on disk exactly while the packaged README is swapped into place, so a
// run killed mid-package can be reconciled on the next run.
const readmeBackupPath = path.join(projectRoot, "README.patch.bak")

/**
 * Restore a manifest left patched by a previous run that was killed mid-package
 * (Ctrl-C, `Stop-Process`, a closed terminal, or a pipeline that terminates its
 * upstream — PowerShell's `Select-Object -First` does exactly that).
 *
 * A `finally` block cannot cover those cases, so the patched manifest is also
 * recorded in a sidecar backup that is reconciled on the next run. This is the
 * same defence-in-depth shape as scripts/publish-nightly.mjs, which keeps a
 * `package.json.backup` for exactly the same reason.
 */
function recoverStaleManifest() {
	if (!fs.existsSync(manifestBackupPath)) {
		return
	}
	const backup = fs.readFileSync(manifestBackupPath, "utf-8")
	let current
	try {
		current = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
	} catch {
		current = undefined
	}

	if (current && current.displayName === JSON.parse(backup).displayName) {
		// The working manifest is still the patched one -> put the original back.
		log.warn("Found a manifest left patched by an interrupted run; restoring it.")
		fs.writeFileSync(packageJsonPath, backup, "utf-8")
		fs.unlinkSync(manifestBackupPath)
		return
	}

	// The manifest changed after the backup was taken; discarding the user's
	// edits would be worse than leaving the stale sidecar for them to inspect.
	log.warn(`A stale ${path.basename(manifestBackupPath)} exists but the manifest changed since.`)
	log.warn("Leaving both in place — delete the backup manually if it is no longer needed.")
}

/**
 * Reconcile a README.md left swapped by a run killed mid-package, the same way
 * recoverStaleManifest repairs the manifest: the sidecar backup always holds
 * the pre-swap original, so copying it back is safe and idempotent.
 */
function recoverStaleReadme() {
	if (!fs.existsSync(readmeBackupPath)) {
		return
	}
	log.warn("Found a README.md left swapped by an interrupted run; restoring it.")
	fs.copyFileSync(readmeBackupPath, readmePath)
	fs.unlinkSync(readmeBackupPath)
}

/**
 * Compute a patch version that always sorts above `baseVersion`.
 *
 * VS Code compares versions with semver, so a `4.1.21` patch cannot overwrite
 * an installed `4.1.21`, and a pre-release (`4.1.21-patch.1`) sorts BELOW the
 * release it is based on — so neither works for an in-place upgrade.
 *
 * We therefore encode the patch on a dedicated, always-higher minor line:
 *
 *   base 4.1.21, revision 1  ->  4.2.1
 *   base 4.1.21, revision 2  ->  4.2.2
 *   base 4.2.0,  revision 1  ->  4.3.1
 *
 * The minor segment is `base.minor + 1`, which keeps the patch unambiguously
 * above every official release in the base's `4.1.x` line while staying easy
 * to read at a glance. The base version is preserved in the artifact filename
 * and in the extension description, so "which base is this?" stays answerable.
 */
function computePatchVersion(baseVersion, revision = 1) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseVersion)
	if (!match) {
		throw new Error(
			`Cannot derive a patch version from "${baseVersion}" — expected plain X.Y.Z. ` +
				`Pass an explicit --version instead.`,
		)
	}
	const [, major, minor] = match
	return `${major}.${Number(minor) + 1}.${revision}`
}

/** Artifact filename carrying both the base version and the patch revision. */
function outputName(baseVersion, revision) {
	const dotted = baseVersion.replace(/\./g, "-")
	return revision === "" ? `cline-patch-${dotted}.vsix` : `cline-patch-${dotted}-r${revision}.vsix`
}

/**
 * Next unused patch revision for this base, so re-running the script produces a
 * NEW version instead of colliding with a VSIX that already exists in dist/.
 *
 * The revision is matched with a regex because it is variable-width, and the
 * base portion is regex-escaped so its dots match literally.
 */
function findNextRevision(baseVersion) {
	if (!fs.existsSync(distDir)) {
		return 1
	}
	// Build the on-disk prefix directly (same shape as outputName) so the regex
	// matches the real filenames exactly, `-r` separator included.
	const stem = `cline-patch-${baseVersion.replace(/\./g, "-")}-r`
	const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)\\.vsix$`)
	let highest = 0
	for (const entry of fs.readdirSync(distDir)) {
		const match = pattern.exec(entry)
		if (match) {
			highest = Math.max(highest, Number.parseInt(match[1], 10))
		}
	}
	return highest + 1
}

/** Recursively collect files under `dir` modified after `mtimeMs`. */
function findNewerFiles(dir, mtimeMs, collected = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			findNewerFiles(full, mtimeMs, collected)
		} else if (entry.isFile() && fs.statSync(full).mtimeMs > mtimeMs) {
			collected.push(full)
		}
	}
	return collected
}

/**
 * Fail early when the build output is missing or older than the sources it is
 * built from. Packaging a stale bundle is the easiest way to ship a patch that
 * silently does nothing for the person installing it.
 */
function assertBuildIsFresh() {
	const missing = []
	if (!fs.existsSync(extensionBundle)) {
		missing.push(extensionBundle)
	}
	if (!fs.existsSync(webviewBuild)) {
		missing.push(webviewBuild)
	}
	if (missing.length > 0) {
		throw new Error(`Missing build output:\n  ${missing.join("\n  ")}\n\nRun the build first:\n  bun run package`)
	}

	const stale = []
	// The backend bundle is built from src/ + proto/; the webview bundle from
	// webview-ui/src/. Check each against its own output.
	stale.push(...findNewerFiles(path.join(projectRoot, "src"), fs.statSync(extensionBundle).mtimeMs))
	const protoDir = path.join(projectRoot, "proto")
	if (fs.existsSync(protoDir)) {
		stale.push(...findNewerFiles(protoDir, fs.statSync(extensionBundle).mtimeMs))
	}
	const webviewSrc = path.join(projectRoot, "webview-ui", "src")
	if (fs.existsSync(webviewSrc)) {
		stale.push(...findNewerFiles(webviewSrc, fs.statSync(webviewBuild).mtimeMs))
	}

	if (stale.length > 0) {
		const preview = stale.slice(0, 10).map((f) => path.relative(projectRoot, f))
		const more = stale.length > preview.length ? `\n  ...and ${stale.length - preview.length} more` : ""
		throw new Error(
			`Build output is older than these sources — packaging it would ship a patch that does nothing:\n` +
				`  ${preview.join("\n  ")}${more}\n\n` +
				`Run the build first (or re-run with --build):\n  bun run package`,
		)
	}
}

/** Run the release-grade build. */
function runBuild() {
	log.step("Running build (bun run package)...")
	execFileSync("bun", ["run", "package"], { cwd: projectRoot, stdio: "inherit" })
}

/**
 * Locate vsce and return the command + leading args to execute it.
 *
 * We invoke vsce's JS entrypoint through the current Node binary rather than
 * the `.bin` shim: on Windows the shim is a `.cmd`, which `execFileSync`
 * cannot spawn without a shell (it fails with EINVAL), and on POSIX the shim
 * is a shell script that has the same problem. Running `node <vsce-js>` is
 * identical on every platform.
 */
function resolveVsce() {
	const binName = process.platform === "win32" ? "vsce.cmd" : "vsce"
	const searchRoots = [path.join(projectRoot, "node_modules"), path.join(projectRoot, "..", "..", "node_modules")]
	for (const root of searchRoots) {
		const entrypoint = path.join(root, "@vscode", "vsce", "vsce")
		if (fs.existsSync(entrypoint)) {
			return { command: process.execPath, args: [entrypoint] }
		}
		const shim = path.join(root, ".bin", binName)
		if (fs.existsSync(shim)) {
			// Fall back to a shell so the shim is interpreted correctly.
			return { command: shim, args: [], shell: true }
		}
	}
	// Last resort: a globally installed vsce on PATH.
	return { command: process.platform === "win32" ? "vsce.cmd" : "vsce", args: [], shell: true }
}

/** "publisher.name" -> ["publisher", "name"] (name may itself contain dots). */
function splitIdentity(identity) {
	const idx = identity.indexOf(".")
	if (idx === -1) {
		throw new Error(`--identity must look like "publisher.name" (got "${identity}").`)
	}
	return [identity.slice(0, idx), identity.slice(idx + 1)]
}

/**
 * Honest, user-facing description for the patched manifest. This is the line
 * VS Code shows at the top of the extension's DETAILS page, so it states
 * plainly what this build is, which upstream version it is based on, and what
 * it adds — anyone skimming the extension list deserves to know all three.
 */
function patchDescription(upstreamDescription, baseVersion, patchVersion) {
	return (
		`Unofficial build of Cline based on v${baseVersion} (patch ${patchVersion}); ` +
		"not affiliated with or endorsed by the Cline team. " +
		"Adds conversation management: rename conversations in the task history view and in the welcome section's " +
		"recent-tasks preview (shown when no task is active; renamed titles also replace the original prompt in the chat header), " +
		"group the conversation history by project " +
		"(toggleable sort option; each conversation files under its project — an explicit assignment if moved, " +
		"else the workspace or cwd it ran in — with subdirectory tasks merged into their workspace root), " +
		"and move conversations between projects by drag-and-drop or menu, recorded as a reversible project assignment " +
		"that leaves the original working directory untouched. " +
		`Upstream: ${upstreamDescription}`
	)
}

/**
 * The honest patch notice appended to the packaged README: what this build is
 * (an unofficial build on base vX.Y.Z), what it adds, and where the official
 * extension lives. It is also the right thing to do if the Cline team ever
 * notices this build in the wild — it names the base version and keeps the
 * credit pointed at the official project.
 */
function patchNotice(baseVersion, patchVersion) {
	return [
		"> **Unofficial build** — This is an unofficial, unpublished build of **Cline**,",
		`> based on **Cline v${baseVersion}** (patch ${patchVersion}). It is not affiliated`,
		"> with, endorsed by, or supported by the Cline team.",
		">",
		"> On top of upstream Cline, this build adds **conversation management features**:",
		">",
		"> - **Rename** conversations in the task history view and in the recent-tasks preview shown on the",
		">   welcome section when no task is active (right-click menu, inline edit); the renamed title also",
		">   replaces the original prompt in the chat header",
		"> - **Group** the conversation history by project (a toggleable sort option, on by default):",
		">   each conversation files under its project — an explicit assignment if you moved it,",
		">   else the workspace root or cwd it ran in. Subdirectory tasks merge into their",
		">   workspace root's group, multi-root workspaces get one group per root, and tasks",
		'>   with no recorded cwd land under "Unknown Project"',
		"> - **Move** conversations between projects by drag-and-drop onto a project group or via the",
		">   right-click menu (targets: open workspace roots plus projects already in your",
		">   history). Moving records a reversible explicit project assignment instead of",
		">   rewriting the recorded working directory",
		">",
		"> For the official extension, install Cline from the VS Code Marketplace.",
		"> Please do not report problems specific to these extra features to the official",
		"> Cline issue tracker.",
	].join("\n")
}

/**
 * The README shipped in the .vsix.
 *
 * Upstream apps/vscode/README.md is EMPTY on purpose — the repo's home page
 * lives elsewhere, and official releases copy README.marketplace.md over it at
 * package time (scripts/marketplace-readme.mjs). This script used to append its
 * one-line notice to that empty file, so a patch VSIX installed with a nearly
 * blank DETAILS page — a single orphaned sentence. Do the same swap the
 * official release does, then append the honest patch notice on top.
 */
function buildPackagedReadme(baseVersion, patchVersion) {
	const base = fs.existsSync(marketplaceReadmePath)
		? fs.readFileSync(marketplaceReadmePath, "utf-8")
		: fs.existsSync(readmePath)
			? fs.readFileSync(readmePath, "utf-8")
			: ""
	return `${base.trimEnd()}\n\n---\n\n${patchNotice(baseVersion, patchVersion)}\n`
}

/**
 * Restore the working tree and exit, for SIGINT/SIGTERM.
 *
 * `finally` covers exceptions but not termination signals, and a killed run is
 * exactly how a developer ends up with a version-bumped manifest checked out.
 * Handlers are installed only while the manifest is patched, and removed again
 * once it is restored, so a normal exit path never double-restores.
 */
function installSignalHandlers(restore) {
	const onSignal = (signal) => {
		log.warn(`Received ${signal} — restoring the working tree.`)
		restore()
		process.exit(1)
	}
	const handlers = {
		SIGINT: onSignal,
		SIGTERM: onSignal,
		SIGHUP: onSignal,
	}
	for (const [signal, handler] of Object.entries(handlers)) {
		process.on(signal, handler)
	}
	activeSignalHandlers = () => {
		for (const [signal, handler] of Object.entries(handlers)) {
			process.removeListener(signal, handler)
		}
	}
}

let activeSignalHandlers = null

/** Undo everything this script mutated, and clear the sidecar backups. */
function restoreWorkingTree(original, readmeOriginal, readmePath) {
	fs.writeFileSync(packageJsonPath, original, "utf-8")
	if (readmeOriginal !== null) {
		fs.writeFileSync(readmePath, readmeOriginal, "utf-8")
	} else if (fs.existsSync(readmePath)) {
		// The packaged README is always written now; if there was no README.md
		// before the run, removing it is the faithful restore.
		fs.rmSync(readmePath)
	}
	if (fs.existsSync(manifestBackupPath)) {
		fs.unlinkSync(manifestBackupPath)
	}
	if (fs.existsSync(readmeBackupPath)) {
		fs.unlinkSync(readmeBackupPath)
	}
	if (activeSignalHandlers) {
		activeSignalHandlers()
		activeSignalHandlers = null
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2))

	// Repair anything a previously killed run left behind, before we read the
	// manifest — otherwise the "base version" would be a patch version.
	recoverStaleManifest()
	recoverStaleReadme()

	if (args.help) {
		console.log(
			fs
				.readFileSync(__filename, "utf-8")
				.split("*/")[0]
				.replace(/^\/\*\*?/, "")
				.replace(/^ \* ?/gm, ""),
		)
		return
	}

	if (args.build) {
		runBuild()
	}

	assertBuildIsFresh()

	const original = fs.readFileSync(packageJsonPath, "utf-8")
	const manifest = JSON.parse(original)
	const baseVersion = manifest.version

	// Version resolution order: explicit --version > --revision > auto-next.
	let version
	let revision
	if (args.version) {
		version = String(args.version)
	} else {
		revision = args.revision ? Number.parseInt(String(args.revision), 10) : findNextRevision(baseVersion)
		if (Number.isNaN(revision) || revision < 1) {
			throw new Error(`--revision must be a positive integer (got "${args.revision}").`)
		}
		version = computePatchVersion(baseVersion, revision)
	}

	const identity = args.identity ? String(args.identity) : `${manifest.publisher}.${manifest.name}`
	const [publisher, name] = identity.includes(".") ? splitIdentity(identity) : [manifest.publisher, identity]
	// Name the artifact after the BASE version plus revision, not the derived
	// patch version, so the filename keeps answering "which base is this?".
	const defaultName = revision === undefined ? outputName(baseVersion, version) : outputName(baseVersion, revision)
	const outPath = path.resolve(projectRoot, args.out ? String(args.out) : path.join("dist", defaultName))

	log.info(`Base version:  ${baseVersion}`)
	log.info(`Patch version: ${version}`)
	log.info(`Identity:      ${publisher}.${name}`)
	log.info(`Output:        ${path.relative(projectRoot, outPath)}`)

	// Mutate the manifest for packaging, then always restore it. The user asked
	// for a patch artifact, not a modified checkout.
	const scripts = { ...manifest.scripts }
	// vsce runs this on `package`. We already built above, and leaving it in
	// would re-run the full build (requiring bun) inside vsce.
	delete scripts["vscode:prepublish"]

	const patched = {
		...manifest,
		version,
		publisher,
		name,
		displayName: `${manifest.displayName} (Patch)`,
		description: patchDescription(manifest.description, baseVersion, version),
		scripts,
	}

	const readmeOriginal = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : null

	fs.mkdirSync(path.dirname(outPath), { recursive: true })

	try {
		writeJson(packageJsonPath, patched)
		// Record the ORIGINAL manifest alongside, so a run killed before the
		// finally block still leaves enough information to restore it.
		fs.writeFileSync(manifestBackupPath, original, "utf-8")
		installSignalHandlers(() => restoreWorkingTree(original, readmeOriginal, readmePath))
		// Swap in the packaged README (see buildPackagedReadme), keeping the
		// original in a sidecar backup so interrupted runs can be reconciled.
		fs.writeFileSync(readmeBackupPath, readmeOriginal, "utf-8")
		fs.writeFileSync(readmePath, buildPackagedReadme(baseVersion, version), "utf-8")

		const vsce = resolveVsce()
		log.step(`Packaging with vsce (${vsce.command})...`)
		execFileSync(
			vsce.command,
			[
				...vsce.args,
				"package",
				// Dependencies are already bundled into dist/extension.js, and the
				// release workflows use this flag to avoid an npm-tree walk over
				// the whole monorepo workspace.
				"--no-dependencies",
				// Scoped secret scanner exemption, matching the release workflows.
				"--allow-package-secrets",
				"sendgrid",
				"--out",
				outPath,
			],
			{ cwd: projectRoot, stdio: "inherit", shell: vsce.shell === true },
		)
	} finally {
		// Restore no matter how vsce exits, and drop the sidecar backup so the
		// next run does not see a stale one.
		restoreWorkingTree(original, readmeOriginal, readmePath)
	}

	const size = fs.statSync(outPath).size
	log.info(`Done: ${path.relative(projectRoot, outPath)} (${(size / 1024 / 1024).toFixed(1)} MiB)`)
	log.info("")
	log.info("Install / upgrade with:")
	log.info(`  code --install-extension "${outPath}" --force`)
	log.info("")
	log.warn("This is an unpublished fork build. Do not publish it to the Marketplace under")
	log.warn("someone else's publisher ID, and do not use the official Cline logo/brand.")
}

try {
	main()
} catch (error) {
	log.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}

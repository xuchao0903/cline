# Cline Patch Build Guide (PATCH-README)

This document records the build steps and common pitfalls of the locally patched Cline extension build. Everything here comes from hands-on experience.
The corresponding build script is `package-patch.mjs` in this directory.

---

## 1. Artifacts and Version Rules

- Artifact: `dist/cline-patch-<base>-r<N>.vsix`, e.g. `cline-patch-4-1-23-r3.vsix`
- Version: derived automatically from the base version onto a minor line that is "always higher", e.g. `4.1.23 → 4.2.1`, `4.2.2`…
  This is what allows VS Code to perform an "in-place upgrade" over the installed official Cline (VS Code refuses to install a VSIX whose version is ≤ the installed one)
- Identity stays `saoudrizwan.claude-dev`, so installing it replaces the official build directly; displayName carries a `(Patch)` marker (a temporary manifest used only during packaging, automatically restored afterwards)
- **DETAILS page content** (see "README/description mechanism" below):
  - description: an honest English statement — unofficial build, based on which version, and which conversation-management features were added
  - README: the official Marketplace README (10.4KB) + an honest notice block (unofficial, based on vX.Y.Z, feature list, pointer to the official build)
- Install:

```powershell
code --install-extension "C:\Projects\cline\apps\vscode\dist\cline-patch-4-1-23-r4.vsix" --force
```

### README/description mechanism (why the DETAILS page once showed only one sentence)

Upstream v4.1.23's `apps/vscode/README.md` is an **intentionally empty 0-byte file** — at release time the official build runs `scripts/marketplace-readme.mjs`, which swaps in `README.marketplace.md` (the real extension README) as `README.md` before packaging. The old version of the patch script did not know about this mechanism and appended one line to the empty file, so after install the DETAILS page showed just a single orphaned sentence.

Now `package-patch.mjs` does the same thing as the official flow: during packaging it writes the `README.marketplace.md` content + the honest notice block into `README.md`, then restores the file afterwards. To edit the notice copy:
- README notice block → the `patchNotice()` function (`package-patch.mjs`)
- description → the `patchDescription()` function

Restore guarantees use the same triple protection as the manifest (`finally` + signal handlers + a `README.patch.bak` sidecar backup, auto-detected and restored on startup). Both `README.patch.bak` and `package.json.patchbak` are excluded via `.vscodeignore`.

---

## 2. Environment Requirements (one-time setup)

| Tool | Requirement | Notes |
|---|---|---|
| Node | ≥ 22 | Runs `package-patch.mjs` and vsce |
| **Bun** | **1.4.2+** | The package manager / task runner pinned by this repo; **do not use npm/yarn/pnpm** |
| Dependencies | `bun install` | Run at the repo root; without it neither vsce nor esbuild can be found |

Install Bun on Windows:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

⚠️ After installing, you **must reopen the terminal** for PATH to take effect (`bun: command not found` is almost always this).

---

## 3. Daily Build Flow

```powershell
# 0. Prerequisite: only apps/vscode or webview-ui code changed; SDK packages untouched
cd C:\Projects\cline\apps\vscode

# 1. With --build: automatically runs check-types → lint → build:production → vsce packaging
node .\scripts\package-patch.mjs --build

# Or run separately (faster when artifacts are already fresh — skips the rebuild):
bun run package
node .\scripts\package-patch.mjs
```

Build chain notes (since 4.1.23):
- `package` = `check-types && lint && build:production`
- `build:production` = `build:webview && esbuild.mjs --production`
- `check-types` first runs `bun run protos` to regenerate proto code, so **no need to regenerate manually after editing `.proto` files**

---

## 4. Upgrading the Upstream Version (e.g. 4.1.23 → 4.1.24)

```powershell
cd C:\Projects\cline
git fetch origin --tags

# 1. Back up local uncommitted changes first (belt and suspenders)
git stash push -u -m "pre-upgrade"

# 2. Fast-forward to the target tag (produces no commits)
git merge --ff-only v4.1.24

# 3. Restore local changes (three-way merge; conflicts covered in the next section)
git stash pop
```

**You must rebuild the SDK after merging, or the build will definitely fail (see Issue 2):**

```powershell
cd C:\Projects\cline
bun run build:sdk
```

### Conflicts actually hit during this upgrade (→ 4.1.24) and their resolutions

11 locally modified files total; 9 merged automatically, only 2 conflicted:

1. **`apps/vscode/package.json`** — upstream restructured the `test:e2e*` scripts (removed `test:e2e:build`/`test:e2e:optimal`, added `build:production`), colliding with the locally added `package:patch*` scripts in the same region.
   Resolution: **keep both sides** — upstream's new `test:e2e` + the local `package:patch` trio (the local scripts do not depend on the removed ones).

2. **`src/sdk/SdkController.ts`** — two spots:
   - import block: upstream's `readCurrentMessages` and the local `resolveSessionProjectPath` are unrelated — **keep both lines**.
   - `currentTaskItem` (⚠️ the only place with a real semantic trap): upstream snapshotted `this.task` into `snapshotTask` to fix a race condition (paired with epoch validation); locally the lookup source was changed from the 100-item window to the full `sortedTaskHistory` to fix a rename-revert bug. **The correct fix is a merge, not either-or**:
     ```ts
     currentTaskItem: snapshotTask?.taskId
         ? sortedTaskHistory.find((item) => item.id === snapshotTask.taskId)
         : undefined,
     ```

     Picking only upstream loses the rename fix; picking only local loses the upstream race protection.

### Post-upgrade verification

```powershell
bun run build:sdk          # Rebuild SDK (mandatory)
cd apps\vscode
node .\scripts\package-patch.mjs --build   # check-types genuinely validates the conflict resolutions
```

Confirm the features made it into the final artifact (⚠️ minified builds mangle identifiers, so **you must probe with string literals** — grepping for function/component names finding nothing is normal):

```powershell
# Backend: your string literal
Select-String -Path dist\extension.js -SimpleMatch 'Task title cannot be empty' -Quiet   # True
# Frontend:
Get-ChildItem webview-ui\build -Recurse -Include *.js | Select-String 'Group by Project' -Quiet
```

---

## 5. FAQ (ordered by frequency)

### Issue 1: `Build output is older than these sources`

```
[ERROR] Build output is older than these sources — packaging it would ship a patch that does nothing
```

**Cause**: this is a built-in foolproof check (staleness guard) in the script, not a bug. `git merge`/`checkout` rewrites every file's timestamp, making `dist/extension.js` look "older" than the sources.
**Fix**: rebuild as prompted: `node .\scripts\package-patch.mjs --build`.
**⚠️ Never** bypass the check with `touch dist/extension.js` — that packages a **hollow patch containing none of the new code** (verified firsthand: after an upgrade, 96+ source files all looked "new" while the artifact still held the old code).

### Issue 2: `Module '"@cline/core"' has no exported member 'xxx'` (flood of errors at check-types)

```
error TS2305: Module '"@cline/core"' has no exported member 'CommandSpawnError'.
```

**Cause**: the SDK packages (`@cline/shared|llms|agents|core|sdk`) resolve each other **only through their compiled `dist/`** (exports point at dist only, no source condition). After pulling upstream, the SDK sources are newer while `dist/` is still old, so new exports cannot be found.
**Fix**: at the repo root, run `bun run build:sdk`, then re-run packaging. A sibling symptom, `error is of type 'unknown'`, shares the same root cause and disappears after the rebuild.

### Issue 3: `bun: command not found` (PowerShell)

Bun was installed but PATH was never refreshed. Reopen the terminal, or use the absolute path `C:\Users\<you>\.bun\bin\bun.exe`.

### Issue 4: the `tmp-protoc/` directory (Windows)

On Windows, if `bun run protos` cannot find protoc, the script downloads a ~12 MB protoc copy into `apps/vscode/tmp-protoc/`. That directory is already excluded via `.vscodeignore` and never lands in the VSIX; if some package comes out suspiciously large, check here first.

### Issue 5: `package.json.patchbak` sneaking into the VSIX

That is the crash-recovery backup written by `package-patch.mjs` during packaging (deleted when packaging finishes, but present on disk while vsce runs). It is already excluded in `.vscodeignore`; a normal artifact is **~38 files / ~8.6 MB** — one extra file means it is this one.

### Issue 6: `package.json` version corrupted after an interrupted package run

The script has triple protection (`finally` + signal handlers + sidecar backups) and normal interruptions restore everything automatically. If the manifest looks wrong (e.g. displayName carrying `(Patch)`, version showing 4.2.x), check for a leftover `package.json.patchbak` — if present, restore as the script prompts. Note: **PowerShell's `Select-Object -First` cuts the pipeline and sends a termination signal downstream**; the script guards against it, but do not wrap the packaging command in it anyway.

---

## 6. Caveats

- This is an **unreleased fork build**: do not publish it to the Marketplace under the official publisher ID, and do not use the official logo/branding.
- `--identity yourname.claude-dev` allows a side-by-side install (without overwriting the official build), but both extensions share the same `~/.cline` global storage and cannot run at the same time.
- Packaging never re-runs the long build — it reuses the already built `dist/extension.js` + `webview-ui/build/`, consistent with the official release flow (`--no-dependencies`).

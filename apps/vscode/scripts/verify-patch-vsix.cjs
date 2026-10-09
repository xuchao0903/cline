// One-off verification: confirm the packaged VSIX carries the patch changes.
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const vsix = path.resolve(process.argv[2])
const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), `vsix-verify-${process.pid}-`))

execFileSync("tar", ["-xf", vsix, "-C", tmp], { stdio: "inherit" })

const root = fs.readdirSync(tmp).find((e) => fs.statSync(path.join(tmp, e)).isDirectory())
const base = path.join(tmp, root)
const manifest = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf-8"))

console.log("identity      :", `${manifest.publisher}.${manifest.name}`)
console.log("version       :", manifest.version)
console.log("displayName   :", manifest.displayName)
console.log("prepublish    :", manifest.scripts["vscode:prepublish"] ?? "(removed)")
console.log("main          :", manifest.main)

const bundle = fs.readFileSync(path.join(base, "dist", "extension.js"), "utf-8")
console.log("\n-- backend bundle (dist/extension.js) --")
for (const needle of ["workspaceRoot", "workspace_root"]) {
	console.log(`  ${needle}: ${bundle.includes(needle) ? "FOUND" : "MISSING"}`)
}

const webviewDir = path.join(base, "webview-ui", "build", "assets")
const webviewFile = fs.readdirSync(webviewDir).find((f) => f === "index.js")
const webview = fs.readFileSync(path.join(webviewDir, webviewFile), "utf-8")
console.log("\n-- webview bundle (webview-ui/build/assets/index.js) --")
for (const needle of ["Unknown Project", "isCurrent"]) {
	console.log(`  ${needle}: ${webview.includes(needle) ? "FOUND" : "MISSING"}`)
}

fs.rmSync(tmp, { recursive: true, force: true })

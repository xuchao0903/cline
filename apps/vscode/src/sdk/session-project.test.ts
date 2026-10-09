import { describe, expect, it } from "vitest"
import { resolveSessionProjectPath, SESSION_PROJECT_PATH_METADATA_KEY } from "./session-project"

describe("resolveSessionProjectPath", () => {
	it("prefers an explicit project assignment over the folder the session ran in", () => {
		expect(
			resolveSessionProjectPath({
				cwd: "/repo/a",
				workspaceRoot: "/repo/a",
				metadata: { [SESSION_PROJECT_PATH_METADATA_KEY]: "/repo/b" },
			}),
		).toBe("/repo/b")
	})

	it("falls back to the cwd, then the workspace root", () => {
		expect(resolveSessionProjectPath({ cwd: "/repo/a", workspaceRoot: "/repo/a" })).toBe("/repo/a")
		expect(resolveSessionProjectPath({ workspaceRoot: "/repo/a" })).toBe("/repo/a")
	})

	it("ignores a blank assignment so a bad write cannot orphan a conversation", () => {
		expect(
			resolveSessionProjectPath({
				cwd: "/repo/a",
				metadata: { [SESSION_PROJECT_PATH_METADATA_KEY]: "   " },
			}),
		).toBe("/repo/a")
	})

	it("returns an empty path for sessions that recorded neither", () => {
		expect(resolveSessionProjectPath({})).toBe("")
		expect(resolveSessionProjectPath({ metadata: {} })).toBe("")
	})
})

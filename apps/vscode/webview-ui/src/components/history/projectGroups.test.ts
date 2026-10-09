import type { HistoryItem } from "@shared/HistoryItem"
import { VcsType, type WorkspaceRoot } from "@shared/multi-root/types"
import { describe, expect, it } from "vitest"
import {
	collectProjectTargets,
	defaultExpanded,
	groupHistoryByProject,
	projectPathKey,
	UNKNOWN_PROJECT_KEY,
} from "./projectGroups"

const makeTask = (id: string, cwd?: string, ts = 1_000): HistoryItem => ({
	id,
	ts,
	task: `Task ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	cwdOnTaskInitialization: cwd,
})

const root = (path: string, name?: string): WorkspaceRoot => ({ path, vcs: VcsType.Git, name })

const linuxOptions = (workspaceRoots: WorkspaceRoot[], primaryRootIndex = 0) => ({
	workspaceRoots,
	primaryRootIndex,
	platform: "linux" as const,
})

describe("groupHistoryByProject", () => {
	it("returns an empty list for empty history", () => {
		expect(groupHistoryByProject([], linuxOptions([]))).toEqual([])
	})

	it("groups a task inside a workspace root under that root and marks it current", () => {
		const groups = groupHistoryByProject([makeTask("a", "/home/u/proj")], linuxOptions([root("/home/u/proj")]))

		expect(groups).toHaveLength(1)
		expect(groups[0].key).toBe("/home/u/proj")
		expect(groups[0].label).toBe("proj")
		expect(groups[0].title).toBe("/home/u/proj")
		expect(groups[0].isCurrent).toBe(true)
		expect(groups[0].tasks.map((task) => task.id)).toEqual(["a"])
	})

	it("merges subdirectory tasks into their workspace-root group", () => {
		const groups = groupHistoryByProject(
			[makeTask("root", "/home/u/proj"), makeTask("sub", "/home/u/proj/packages/app")],
			linuxOptions([root("/home/u/proj")]),
		)

		expect(groups).toHaveLength(1)
		expect(groups[0].tasks.map((task) => task.id)).toEqual(["root", "sub"])
		expect(groups[0].isCurrent).toBe(true)
	})

	it("keeps tasks outside every root in their own project group", () => {
		const groups = groupHistoryByProject([makeTask("a", "/tmp/other")], linuxOptions([root("/home/u/proj")]))

		expect(groups).toHaveLength(1)
		expect(groups[0].key).toBe("/tmp/other")
		expect(groups[0].label).toBe("other")
		expect(groups[0].isCurrent).toBe(false)
	})

	it("does not treat a sibling path sharing a prefix as the current project", () => {
		const groups = groupHistoryByProject([makeTask("a", "/home/u/proj-other")], linuxOptions([root("/home/u/proj")]))

		expect(groups[0].isCurrent).toBe(false)
	})

	it("groups tasks without a recorded cwd into the unknown group", () => {
		const groups = groupHistoryByProject([makeTask("a", undefined), makeTask("b", "")], linuxOptions([root("/home/u/proj")]))

		expect(groups).toHaveLength(1)
		expect(groups[0].key).toBe(UNKNOWN_PROJECT_KEY)
		expect(groups[0].label).toBe("Unknown Project")
		expect(groups[0].title).toBeUndefined()
		expect(groups[0].isCurrent).toBe(false)
		expect(groups[0].tasks.map((task) => task.id)).toEqual(["a", "b"])
	})

	it("normalizes win32 separators and case before grouping", () => {
		const groups = groupHistoryByProject([makeTask("a", "C:\\Repo\\App\\src")], {
			workspaceRoots: [root("C:\\Repo\\App")],
			primaryRootIndex: 0,
			platform: "win32",
		})

		expect(groups).toHaveLength(1)
		expect(groups[0].key).toBe("c:/repo/app")
		expect(groups[0].label).toBe("App")
		expect(groups[0].title).toBe("C:/Repo/App")
		expect(groups[0].isCurrent).toBe(true)
	})

	it("keeps case-differing paths in separate groups on linux", () => {
		const groups = groupHistoryByProject([makeTask("a", "/repo/app")], linuxOptions([root("/Repo/App")]))

		expect(groups[0].isCurrent).toBe(false)
		expect(groups[0].key).toBe("/repo/app")
	})

	it("ignores trailing separators on the root", () => {
		const groups = groupHistoryByProject([makeTask("a", "/home/u/proj")], linuxOptions([root("/home/u/proj/")]))

		expect(groups[0].key).toBe("/home/u/proj")
		expect(groups[0].isCurrent).toBe(true)
	})

	it("orders primary current, other current, external, then unknown groups", () => {
		const groups = groupHistoryByProject(
			[
				makeTask("external", "/ext/alpha", 999),
				makeTask("secondary", "/ws/lib", 30),
				makeTask("primary", "/ws/app", 10),
				makeTask("unknown", undefined, 500),
			],
			linuxOptions([root("/ws/app"), root("/ws/lib")], 0),
		)

		expect(groups.map((group) => group.label)).toEqual(["app", "lib", "alpha", "Unknown Project"])
	})

	it("orders external projects by most recent activity", () => {
		const groups = groupHistoryByProject(
			[makeTask("older", "/ext/alpha", 1), makeTask("newer", "/ext/beta", 100)],
			linuxOptions([]),
		)

		expect(groups.map((group) => group.label)).toEqual(["beta", "alpha"])
	})

	it("preserves newest-first input order within a group", () => {
		const groups = groupHistoryByProject(
			[makeTask("newer", "/home/u/proj", 200), makeTask("older", "/home/u/proj", 100)],
			linuxOptions([root("/home/u/proj")]),
		)

		expect(groups[0].tasks.map((task) => task.id)).toEqual(["newer", "older"])
	})

	it("keeps an empty group for a retained project that lost its last conversation", () => {
		const groups = groupHistoryByProject([makeTask("a", "/ext/alpha")], {
			...linuxOptions([root("/home/u/proj")]),
			retainedProjectPaths: ["/ext/beta"],
		})

		expect(groups.map((group) => [group.key, group.tasks.length])).toEqual([
			["/ext/alpha", 1],
			["/ext/beta", 0],
		])
	})

	it("does not duplicate a group that still has conversations", () => {
		const groups = groupHistoryByProject([makeTask("a", "/ext/alpha")], {
			...linuxOptions([]),
			retainedProjectPaths: ["/ext/alpha", " /ext/alpha/ "],
		})

		expect(groups).toHaveLength(1)
		expect(groups[0].tasks.map((task) => task.id)).toEqual(["a"])
	})

	it("marks a retained workspace root's empty group as current", () => {
		const groups = groupHistoryByProject([makeTask("a", "/ext/alpha")], {
			...linuxOptions([root("/home/u/proj")]),
			retainedProjectPaths: ["/home/u/proj"],
		})

		const empty = groups.find((group) => group.tasks.length === 0)
		expect(empty?.key).toBe("/home/u/proj")
		expect(empty?.isCurrent).toBe(true)
	})

	it("ignores blank retained paths", () => {
		const groups = groupHistoryByProject([], {
			...linuxOptions([]),
			retainedProjectPaths: ["", "   ", undefined],
		})

		expect(groups).toEqual([])
	})
})

describe("defaultExpanded", () => {
	it("expands only current groups when history belongs to this workspace", () => {
		expect(defaultExpanded(true, true)).toBe(true)
		expect(defaultExpanded(false, true)).toBe(false)
	})

	it("expands every group when no history belongs to this workspace", () => {
		expect(defaultExpanded(true, false)).toBe(true)
		expect(defaultExpanded(false, false)).toBe(true)
	})
})

describe("collectProjectTargets", () => {
	it("offers the open workspace folders, then the projects seen in history", () => {
		const targets = collectProjectTargets({
			workspaceRoots: [root("/home/u/proj", "Workspace Name")],
			historyPaths: ["/home/u/proj", "/tmp/elsewhere", undefined, ""],
			platform: "linux",
		})

		expect(targets).toEqual([
			// The workspace root keeps its display name rather than the folder name.
			{ path: "/home/u/proj", label: "Workspace Name" },
			{ path: "/tmp/elsewhere", label: "elsewhere" },
		])
	})

	it("keeps the current project listed last so it can be shown as unavailable", () => {
		const targets = collectProjectTargets({
			workspaceRoots: [root("/home/u/proj")],
			historyPaths: ["/home/u/proj"],
			currentProjectPath: "/home/u/proj",
			platform: "linux",
		})

		expect(targets.map((target) => target.path)).toEqual(["/home/u/proj"])
	})

	it("folds a project the conversation is leaving out of the list of other targets", () => {
		const targets = collectProjectTargets({
			workspaceRoots: [],
			historyPaths: ["/home/u/proj", "/tmp/elsewhere"],
			currentProjectPath: "/home/u/proj",
			platform: "linux",
		})

		expect(targets.map((target) => target.path)).toEqual(["/tmp/elsewhere", "/home/u/proj"])
	})

	it("treats Windows paths as the same project regardless of case and separators", () => {
		const targets = collectProjectTargets({
			workspaceRoots: [root("C:\\Users\\Me\\Proj")],
			historyPaths: ["c:/users/me/proj/"],
			platform: "win32",
		})

		expect(targets).toEqual([{ path: "C:\\Users\\Me\\Proj", label: "Proj" }])
	})
})

describe("projectPathKey", () => {
	it("normalizes separators, trailing slashes and Windows casing", () => {
		expect(projectPathKey("C:\\Users\\Me\\Proj\\", "win32")).toBe("c:/users/me/proj")
		expect(projectPathKey("/home/u/proj/", "linux")).toBe("/home/u/proj")
		expect(projectPathKey("/home/u/Proj", "linux")).toBe("/home/u/Proj")
	})
})

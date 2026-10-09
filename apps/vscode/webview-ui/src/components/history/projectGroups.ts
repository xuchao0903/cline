import type { Platform } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { WorkspaceRoot } from "@shared/multi-root/types"
import { isTaskCwdOutsideWorkspace } from "@/components/chat/task-header/TaskWorkingDirectoryBadge"

/** Group key for tasks whose project (cwd) is unknown, e.g. legacy imports. */
export const UNKNOWN_PROJECT_KEY = ""

/** Display label for {@link UNKNOWN_PROJECT_KEY}. */
export const UNKNOWN_PROJECT_LABEL = "Unknown Project"

/** A set of history tasks that ran in the same project (workspace root or cwd). */
export type ProjectGroup = {
	/** Normalized project path; "" groups tasks with no recorded cwd. */
	key: string
	/** Display name: workspace-root name, folder basename, or "Unknown Project". */
	label: string
	/** Full path shown as the group header's tooltip; absent for the unknown group. */
	title?: string
	/** True when the group's path is one of the workspace roots open in this window. */
	isCurrent: boolean
	/** Tasks in this group, preserving the input order (callers pass newest-first). */
	tasks: HistoryItem[]
	/** Newest task timestamp in the group; used for group ordering only. */
	newestTs: number
}

export type GroupHistoryOptions = {
	/** Workspace roots open in this window; tasks inside one count as "current". */
	workspaceRoots: WorkspaceRoot[]
	/** Index of the primary root, which sorts ahead of other current groups. */
	primaryRootIndex: number
	/** Platform used for path comparison and display formatting. */
	platform: Platform
	/**
	 * Projects remembered after all their conversations were moved away; they
	 * keep an empty group so the header (and its drop target) survives.
	 */
	retainedProjectPaths?: (string | undefined)[]
}

/**
 * Normalizes a path for grouping and menu targets only. Mirrors
 * `normalizeForComparison` in TaskWorkingDirectoryBadge (win32: backslashes
 * become slashes and case folds; trailing separators stripped) so preview
 * grouping agrees with the working-directory badge's containment checks, and
 * so "already in this project" checks survive Windows path casing.
 */
export function projectPathKey(path: string, platform: Platform): string {
	let normalized = path.trim()
	if (platform === "win32") {
		normalized = normalized.replace(/\\/g, "/").toLowerCase()
	}
	while (normalized.length > 1 && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

/** Last path segment for display, platform-aware about backslash separators. */
function projectBasename(path: string, platform: Platform): string {
	let cleaned = path.trim()
	if (platform === "win32") {
		cleaned = cleaned.replace(/\\/g, "/")
	}
	cleaned = cleaned.replace(/\/+$/, "")
	return cleaned.split("/").filter(Boolean).pop() || cleaned
}

/** A project folder a conversation can be filed under. */
export type ProjectMenuEntry = {
	/** Absolute path stored on the conversation. */
	path: string
	/** Folder name shown in the menu. */
	label: string
}

export type CollectProjectTargetsOptions = {
	/** Workspace roots open in this window. */
	workspaceRoots?: WorkspaceRoot[]
	/** Project paths already present in the loaded history. */
	historyPaths?: (string | undefined)[]
	/** Project the conversation is currently filed under. */
	currentProjectPath?: string
	/** Platform used for path comparison and display formatting. */
	platform: Platform
}

/**
 * Projects a conversation can be moved to: the folders open in this window
 * plus the projects already visible in history. The history entries matter
 * because moving the last conversation out of a project removes that project
 * group — and with it the only drop target for moving the conversation back.
 */
export function collectProjectTargets(options: CollectProjectTargetsOptions): ProjectMenuEntry[] {
	const { workspaceRoots, historyPaths, currentProjectPath, platform } = options
	const targets = new Map<string, ProjectMenuEntry>()

	const add = (path: string | undefined, label?: string) => {
		const trimmed = path?.trim()
		if (!trimmed) {
			return
		}
		const key = projectPathKey(trimmed, platform)
		if (targets.has(key)) {
			return
		}
		targets.set(key, { path: trimmed, label: label?.trim() || projectBasename(trimmed, platform) })
	}

	for (const root of workspaceRoots ?? []) {
		add(root.path, root.name)
	}
	for (const path of historyPaths ?? []) {
		add(path)
	}

	// The current project is never a valid target, so it is moved to the end
	// where a caller can show it as the disabled "you are here" row.
	if (currentProjectPath) {
		const currentKey = projectPathKey(currentProjectPath, platform)
		const current = targets.get(currentKey)
		if (current) {
			targets.delete(currentKey)
			targets.set(currentKey, current)
		}
	}

	return Array.from(targets.values())
}

/** Full path for tooltips, shown with forward slashes like the history view. */
function displayPath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/\/+$/, "")
}

type MutableGroup = ProjectGroup

/**
 * Groups history tasks by the project they ran in.
 *
 * - A task whose cwd lies inside an open workspace root merges into that root's
 *   group (subdirectory tasks included) and is marked `isCurrent`.
 * - A task elsewhere forms its own project group from its cwd.
 * - A task with no recorded cwd lands in the unknown group.
 *
 * Order: the primary current project first, then other current projects, then
 * external projects (each by most recent activity), and the unknown group last.
 * Input order is preserved within a group, so callers should pass newest-first.
 *
 * Retained projects (see {@link GroupHistoryOptions.retainedProjectPaths}) that
 * no conversation belongs to anymore still get an empty group, so the header
 * and its drop target survive for moving conversations back.
 */
export function groupHistoryByProject(tasks: HistoryItem[], options: GroupHistoryOptions): ProjectGroup[] {
	const { workspaceRoots, primaryRootIndex, platform, retainedProjectPaths } = options
	const roots = workspaceRoots ?? []
	const groups = new Map<string, MutableGroup>()

	for (const task of tasks) {
		const cwd = task.cwdOnTaskInitialization?.trim() ?? ""
		const matchedRoot = cwd
			? roots.find((root) => root.path?.trim() && !isTaskCwdOutsideWorkspace(cwd, [root], platform))
			: undefined

		let key: string
		let label: string
		let title: string | undefined
		let isCurrent: boolean

		if (!cwd) {
			key = UNKNOWN_PROJECT_KEY
			label = UNKNOWN_PROJECT_LABEL
			title = undefined
			isCurrent = false
		} else if (matchedRoot) {
			key = projectPathKey(matchedRoot.path, platform)
			label = matchedRoot.name?.trim() || projectBasename(matchedRoot.path, platform)
			title = displayPath(matchedRoot.path)
			isCurrent = true
		} else {
			key = projectPathKey(cwd, platform)
			label = projectBasename(cwd, platform)
			title = displayPath(cwd)
			isCurrent = false
		}

		let group = groups.get(key)
		if (!group) {
			group = { key, label, title, isCurrent, tasks: [], newestTs: 0 }
			groups.set(key, group)
		}
		group.tasks.push(task)
		group.newestTs = Math.max(group.newestTs, task.ts)
	}

	// Retained projects keep an empty group so the header (and its drop
	// target) survives for moving conversations back. A project that still
	// holds conversations is not duplicated.
	for (const retainedPath of retainedProjectPaths ?? []) {
		const trimmed = retainedPath?.trim()
		if (!trimmed) {
			continue
		}
		const retainedKey = projectPathKey(trimmed, platform)
		if (groups.has(retainedKey)) {
			continue
		}
		const matchedRoot = roots.find((root) => root.path?.trim() && projectPathKey(root.path, platform) === retainedKey)
		groups.set(retainedKey, {
			key: retainedKey,
			label: matchedRoot?.name?.trim() || projectBasename(trimmed, platform),
			title: displayPath(trimmed),
			isCurrent: matchedRoot !== undefined,
			tasks: [],
			newestTs: 0,
		})
	}

	const primaryRoot = roots[primaryRootIndex]
	const primaryKey = primaryRoot?.path ? projectPathKey(primaryRoot.path, platform) : undefined

	return Array.from(groups.values()).sort((a, b) => {
		const rank = (group: ProjectGroup): number => {
			if (group.key === UNKNOWN_PROJECT_KEY) {
				return 3
			}
			if (group.isCurrent) {
				return primaryKey !== undefined && group.key === primaryKey ? 0 : 1
			}
			return 2
		}
		const rankDiff = rank(a) - rank(b)
		if (rankDiff !== 0) {
			return rankDiff
		}
		if (b.newestTs !== a.newestTs) {
			return b.newestTs - a.newestTs
		}
		return a.label.localeCompare(b.label)
	})
}

/**
 * Default expansion for a group: when any history belongs to the current
 * workspace, only those groups start expanded ("show this project's
 * conversations"); otherwise everything starts expanded so a fresh project or
 * a no-workspace window never renders as an empty wall of collapsed headers.
 */
export function defaultExpanded(isCurrent: boolean, hasCurrentGroup: boolean): boolean {
	return hasCurrentGroup ? isCurrent : true
}

/**
 * Projects that have lost their last conversation to a move.
 *
 * Both history surfaces derive project groups purely from the conversations
 * in them, so when the last conversation of a project is moved elsewhere the
 * project's group header — and with it the drop target for moving anything
 * back — disappears. Paths remembered here keep the (now empty) group header
 * rendered in the task history view and the welcome preview until a
 * conversation is filed under the project again. Deleting the whole history
 * clears them.
 */
const RETAINED_PROJECTS_KEY = "cline.historyRetainedProjects"

/** Compares paths tolerantly: trims, forward slashes, no trailing separator. */
const normalized = (path: string): string => path.trim().replace(/\\/g, "/").replace(/\/+$/, "")

const sameProject = (a: string, b: string): boolean => normalized(a) === normalized(b)

export function getRetainedProjects(): string[] {
	try {
		const raw = window.localStorage.getItem(RETAINED_PROJECTS_KEY)
		if (!raw) {
			return []
		}
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			return []
		}
		return parsed.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
	} catch {
		return []
	}
}

const writeRetainedProjects = (paths: string[]): void => {
	try {
		window.localStorage.setItem(RETAINED_PROJECTS_KEY, JSON.stringify(paths))
	} catch {
		// localStorage unavailable — retention degrades gracefully.
	}
}

/**
 * Remembers a project a conversation was just moved out of, so its group
 * header survives the move even when it held the only conversation.
 */
export function rememberRetainedProject(path: string | undefined): void {
	const trimmed = path?.trim()
	if (!trimmed || getRetainedProjects().some((known) => sameProject(known, trimmed))) {
		return
	}
	writeRetainedProjects([...getRetainedProjects(), trimmed])
}

/** Forgets a retained project once it holds conversations again. */
export function forgetRetainedProject(path: string | undefined): void {
	const trimmed = path?.trim()
	if (!trimmed) {
		return
	}
	const retained = getRetainedProjects()
	const remaining = retained.filter((known) => !sameProject(known, trimmed))
	if (remaining.length === retained.length) {
		return
	}
	writeRetainedProjects(remaining)
}

/** Clears every retained project, e.g. when the whole history is deleted. */
export function clearRetainedProjects(): void {
	try {
		window.localStorage.removeItem(RETAINED_PROJECTS_KEY)
	} catch {
		// localStorage unavailable — nothing to clear.
	}
}

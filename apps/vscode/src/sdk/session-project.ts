/**
 * Session metadata key that pins a conversation to a project folder.
 *
 * A session's project is otherwise inferred from the cwd it happened to run
 * in, which is wrong whenever a user does B-project work from an A-project
 * window. Writing the intended folder here overrides that inference for
 * grouping, workspace filtering, and resume, while leaving the recorded
 * `cwd`/`workspaceRoot` untouched so the move stays reversible.
 */
export const SESSION_PROJECT_PATH_METADATA_KEY = "clineProjectPath"

/** The subset of a session record needed to resolve its project folder. */
export type SessionProjectFields = {
	cwd?: string | null
	workspaceRoot?: string | null
	metadata?: Record<string, unknown> | null
}

/**
 * Project folder a conversation belongs to: an explicit assignment first,
 * then the cwd it ran in, then its workspace root. Empty when the session
 * recorded none (e.g. legacy imports).
 */
export function resolveSessionProjectPath(record: SessionProjectFields): string {
	const assigned = record.metadata?.[SESSION_PROJECT_PATH_METADATA_KEY]
	if (typeof assigned === "string" && assigned.trim().length > 0) {
		return assigned.trim()
	}
	const cwd = record.cwd?.trim()
	if (cwd) {
		return cwd
	}
	return record.workspaceRoot?.trim() ?? ""
}

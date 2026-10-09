import { MoveTaskToProjectRequest, RenameTaskRequest } from "@shared/proto/cline/task"
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { forgetRetainedProject, rememberRetainedProject } from "./retainedProjects"

/** Conversation the right-click menu is open on. */
export type HistoryMenuState = {
	taskId: string
	/** Project the conversation is currently filed under. */
	projectPath?: string
	/** Right-click position, in client coordinates. */
	x: number
	y: number
}

type HistoryItemActionsOptions = {
	/** Called after the conversation was renamed, to refresh the local list. */
	onRenamed?: (taskId: string, title: string) => void
	/** Called after the conversation was moved, to refresh the local list. */
	onMoved?: (taskId: string, projectPath: string) => void
	/** Called when a rename or move request failed. */
	onError?: (error: unknown) => void
}

/**
 * Rename + move-to-project behavior shared by the history list and the welcome
 * preview, so both surfaces issue the same requests and dismiss the same way.
 */
export function useHistoryItemActions(options: HistoryItemActionsOptions = {}) {
	const [menu, setMenu] = useState<HistoryMenuState | null>(null)
	const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null)
	// Kept in a ref so the callbacks below stay stable while the caller passes
	// inline handlers; the menu must not re-subscribe on every parent render.
	const optionsRef = useRef(options)
	optionsRef.current = options

	useEffect(() => {
		const clear = () => setMenu(null)
		// Scrolling the list would leave the menu anchored to stale coordinates,
		// but scrolling inside the menu's own project list must not dismiss it.
		const handleScroll = (event: Event) => {
			const target = event.target as Element | null
			if (target?.closest?.("[role='menu']")) {
				return
			}
			clear()
		}
		window.addEventListener("resize", clear)
		window.addEventListener("scroll", handleScroll, true)
		return () => {
			window.removeEventListener("resize", clear)
			window.removeEventListener("scroll", handleScroll, true)
		}
	}, [])

	const openMenu = useCallback((event: MouseEvent, taskId: string, projectPath?: string) => {
		// Replaces the webview's default Cut/Copy/Paste menu.
		event.preventDefault()
		event.stopPropagation()
		setMenu({ taskId, projectPath, x: event.clientX, y: event.clientY })
	}, [])

	const dismissMenu = useCallback(() => setMenu(null), [])

	const beginRename = useCallback(() => {
		setRenamingTaskId(menu?.taskId ?? null)
		setMenu(null)
	}, [menu])

	const commitRename = useCallback(
		async (title: string) => {
			const taskId = renamingTaskId
			setRenamingTaskId(null)
			if (!taskId) {
				return
			}
			try {
				await TaskServiceClient.renameTask(RenameTaskRequest.create({ taskId, title }))
				optionsRef.current.onRenamed?.(taskId, title)
			} catch (error) {
				console.error("Error renaming task:", error)
				optionsRef.current.onError?.(error)
			}
		},
		[renamingTaskId],
	)

	const cancelRename = useCallback(() => setRenamingTaskId(null), [])

	const moveToProject = useCallback(async (taskId: string, projectPath: string, sourceProjectPath?: string) => {
		// Remember the project this conversation is leaving so its group
		// header survives the move even when it held the only conversation;
		// rolled back below if the move fails.
		rememberRetainedProject(sourceProjectPath)
		try {
			await TaskServiceClient.moveTaskToProject(MoveTaskToProjectRequest.create({ taskId, projectPath }))
			optionsRef.current.onMoved?.(taskId, projectPath)
		} catch (error) {
			forgetRetainedProject(sourceProjectPath)
			console.error("Error moving task to another project:", error)
			optionsRef.current.onError?.(error)
		}
	}, [])

	return { menu, renamingTaskId, openMenu, dismissMenu, beginRename, commitRename, cancelRename, moveToProject }
}

import { RenameTaskRequest } from "@shared/proto/cline/task"
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

/** Conversation the right-click menu is open on. */
export type HistoryMenuState = {
	taskId: string
	/** Right-click position, in client coordinates. */
	x: number
	y: number
}

type HistoryItemActionsOptions = {
	/** Called after the conversation was renamed, to refresh the local list. */
	onRenamed?: (taskId: string, title: string) => void
	/** Called when a rename request failed. */
	onError?: (error: unknown) => void
}

/**
 * Rename behavior shared by the history list and the welcome preview, so both
 * surfaces issue the same requests and dismiss the same way.
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
		// Scrolling the list would leave the menu anchored to stale coordinates.
		window.addEventListener("resize", clear)
		window.addEventListener("scroll", clear, true)
		return () => {
			window.removeEventListener("resize", clear)
			window.removeEventListener("scroll", clear, true)
		}
	}, [])

	const openMenu = useCallback((event: MouseEvent, taskId: string) => {
		// Replaces the webview's default Cut/Copy/Paste menu.
		event.preventDefault()
		event.stopPropagation()
		setMenu({ taskId, x: event.clientX, y: event.clientY })
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

	return { menu, renamingTaskId, openMenu, dismissMenu, beginRename, commitRename, cancelRename }
}

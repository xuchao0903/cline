import type { Platform } from "@shared/ExtensionMessage"
import { FolderIcon, PencilLineIcon } from "lucide-react"
import { type DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react"
import { type ProjectMenuEntry, projectPathKey } from "./projectGroups"

/** MIME type carrying the id of the conversation being dragged. */
export const HISTORY_TASK_DRAG_MIME = "application/x-cline-task-id"

/**
 * Marks a conversation row as the drag source. The custom MIME type keeps
 * unrelated drags (text selection, files) from being treated as a move.
 */
export function startHistoryTaskDrag(event: DragEvent<HTMLElement>, taskId: string): void {
	event.dataTransfer.setData(HISTORY_TASK_DRAG_MIME, taskId)
	event.dataTransfer.setData("text/plain", taskId)
	event.dataTransfer.effectAllowed = "move"
}

/** Id of the conversation being dragged over a project group, if any. */
export function readDraggedTaskId(event: DragEvent<HTMLElement>): string | null {
	return event.dataTransfer.getData(HISTORY_TASK_DRAG_MIME) || null
}

const MENU_ITEM_CLASS =
	"flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-left text-xs outline-none hover:bg-list-hover focus:bg-list-hover"

type HistoryItemMenuProps = {
	/** Right-click position, in client coordinates. */
	position: { x: number; y: number }
	/** Projects the conversation can be filed under. */
	projects: ProjectMenuEntry[]
	/** Project the conversation is currently filed under. */
	currentProjectPath?: string
	/** Platform used to compare the current project with the menu targets. */
	platform: Platform
	onRename: () => void
	onMoveToProject: (projectPath: string) => void
	onDismiss: () => void
}

/**
 * Right-click menu for a conversation. Replaces the webview's default
 * Cut/Copy/Paste menu with the two actions that act on a conversation: rename
 * it, or file it under a different project.
 */
const HistoryItemMenu = ({
	position,
	projects,
	currentProjectPath,
	platform,
	onRename,
	onMoveToProject,
	onDismiss,
}: HistoryItemMenuProps) => {
	const menuRef = useRef<HTMLDivElement>(null)
	// Starts at the pointer, then gets clamped once the menu has been measured.
	const [placement, setPlacement] = useState({ left: position.x, top: position.y })

	useLayoutEffect(() => {
		const element = menuRef.current
		if (!element) {
			return
		}
		const { width, height } = element.getBoundingClientRect()
		setPlacement({
			left: Math.max(4, Math.min(position.x, window.innerWidth - width - 4)),
			top: Math.max(4, Math.min(position.y, window.innerHeight - height - 4)),
		})
	}, [position.x, position.y])

	useEffect(() => {
		const handlePointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) {
				onDismiss()
			}
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onDismiss()
			}
		}
		// Capture phase: a right-click elsewhere dismisses before it re-opens
		// the menu on the new row.
		window.addEventListener("pointerdown", handlePointerDown, true)
		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true)
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [onDismiss])

	const currentKey = currentProjectPath ? projectPathKey(currentProjectPath, platform) : undefined
	const movableProjects = projects.filter((project) => projectPathKey(project.path, platform) !== currentKey)

	return (
		<div
			aria-label="Conversation actions"
			className="fixed z-50 min-w-48 max-w-80 overflow-hidden rounded-xs border border-editor-group-border bg-menu py-1 text-menu-foreground shadow-md"
			onContextMenu={(event) => event.preventDefault()}
			ref={menuRef}
			role="menu"
			style={{ left: placement.left, top: placement.top }}>
			<button
				className={MENU_ITEM_CLASS}
				onClick={() => {
					onDismiss()
					onRename()
				}}
				role="menuitem"
				type="button">
				<PencilLineIcon className="size-3.5 shrink-0 text-description" />
				Rename…
			</button>
			{movableProjects.length > 0 && (
				<>
					<div className="mx-1 my-1 h-px bg-editor-group-border" role="separator" />
					<div className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-description">
						Move to project
					</div>
					<div className="max-h-48 overflow-y-auto">
						{movableProjects.map((project) => (
							<button
								className={MENU_ITEM_CLASS}
								key={project.path}
								onClick={() => {
									onDismiss()
									onMoveToProject(project.path)
								}}
								role="menuitem"
								title={project.path}
								type="button">
								<FolderIcon className="size-3.5 shrink-0 text-description" />
								<span className="truncate">{project.label}</span>
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}

export default HistoryItemMenu

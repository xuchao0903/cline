import { PencilLineIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

const MENU_ITEM_CLASS =
	"flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-left text-xs outline-none hover:bg-list-hover focus:bg-list-hover"

type HistoryItemMenuProps = {
	/** Right-click position, in client coordinates. */
	position: { x: number; y: number }
	onRename: () => void
	onDismiss: () => void
}

/**
 * Right-click menu for a conversation. Replaces the webview's default
 * Cut/Copy/Paste menu with the action that acts on a conversation: rename it.
 */
const HistoryItemMenu = ({ position, onRename, onDismiss }: HistoryItemMenuProps) => {
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
		</div>
	)
}

export default HistoryItemMenu

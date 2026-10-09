import { useCallback, useEffect, useRef, useState } from "react"

type HistoryTitleInputProps = {
	/** Title the edit starts from. */
	value: string
	/** Called with the trimmed new title. Not called when the draft is blank. */
	onCommit: (title: string) => void
	/** Called when the edit is abandoned (Escape, or a blank draft). */
	onCancel: () => void
	className?: string
}

/**
 * Inline editor for a conversation title. Enter or blur saves, Escape cancels,
 * and a blank draft is treated as a cancel so the title can never be emptied.
 */
const HistoryTitleInput = ({ value, onCommit, onCancel, className }: HistoryTitleInputProps) => {
	const [draft, setDraft] = useState(value)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.focus()
		inputRef.current?.select()
	}, [])

	const commit = useCallback(() => {
		const next = draft.trim()
		if (!next) {
			onCancel()
			return
		}
		onCommit(next)
	}, [draft, onCancel])

	return (
		<input
			aria-label="Conversation title"
			className={
				className ??
				"w-full min-w-0 rounded-xs border border-input-border bg-input-background px-1 py-0.5 text-xs text-input-foreground outline-none focus:border-button-background"
			}
			onBlur={commit}
			onChange={(event) => setDraft(event.target.value)}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				event.stopPropagation()
				if (event.key === "Enter") {
					event.preventDefault()
					commit()
				} else if (event.key === "Escape") {
					event.preventDefault()
					onCancel()
				}
			}}
			ref={inputRef}
			value={draft}
		/>
	)
}

export default HistoryTitleInput

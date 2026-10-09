import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TaskHeader from "./TaskHeader"

const mocks = vi.hoisted(() => ({
	state: {
		currentTaskItem: undefined as HistoryItem | undefined,
		expandTaskHeader: true,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: { planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" },
		currentTaskItem: mocks.state.currentTaskItem,
		mode: "act",
		expandTaskHeader: mocks.state.expandTaskHeader,
		setExpandTaskHeader: vi.fn(),
		environment: "production",
		workspaceRoots: [],
		platform: "linux",
	}),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({ selectedModelInfo: { supportsPromptCache: false, supportsImages: false } }),
}))

vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({
	useProviderUsageCostDisplay: () => "show",
}))

// The header's siblings all need host state or context providers this test has
// no interest in; stub them so only the title logic is under test.
vi.mock("@/components/chat/task-header/ContextWindow", () => ({ default: () => null }))
vi.mock("@/components/chat/task-header/TaskWorkingDirectoryBadge", () => ({ default: () => null }))
vi.mock("@/components/chat/task-header/buttons/CopyTaskButton", () => ({ default: () => null }))
vi.mock("@/components/chat/task-header/buttons/DeleteTaskButton", () => ({ default: () => null }))
vi.mock("@/components/chat/task-header/buttons/NewTaskButton", () => ({ default: () => null }))

const makeTaskMessage = (text: string): ClineMessage => ({ ts: 1, type: "say", say: "task", text }) as unknown as ClineMessage

const renamedItem: HistoryItem = {
	id: "task-1",
	ts: 1,
	task: "ABC",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
}

const renderHeader = (taskText: string, options: { currentTaskItem?: HistoryItem; expanded?: boolean } = {}) => {
	mocks.state.currentTaskItem = options.currentTaskItem
	mocks.state.expandTaskHeader = options.expanded ?? true
	return render(
		<TaskHeader
			cacheReads={0}
			cacheWrites={0}
			doesModelSupportPromptCache={false}
			onClose={vi.fn()}
			task={makeTaskMessage(taskText)}
			tokensIn={0}
			tokensOut={0}
			totalCost={0}
		/>,
	)
}

describe("TaskHeader title", () => {
	beforeEach(() => {
		mocks.state.currentTaskItem = undefined
		mocks.state.expandTaskHeader = true
	})

	it("shows the conversation's renamed title instead of the original prompt", () => {
		renderHeader("你好", { currentTaskItem: renamedItem })

		expect(screen.getByText("ABC")).toBeInTheDocument()
	})

	it("does not keep the pre-rename name visible under the new one", () => {
		renderHeader("你好", { currentTaskItem: renamedItem })

		// A rename replaces the name; showing the old one underneath made the
		// header read as two stacked names for a single conversation.
		expect(screen.queryByText("你好")).toBeNull()
	})

	it("falls back to the task prompt when the conversation has no history record", () => {
		renderHeader("你好")

		expect(screen.getByText("你好")).toBeInTheDocument()
	})

	it("shows only the stored title for a multi-line prompt", () => {
		// The stored title is the prompt's first line; the header is the
		// conversation's name, not a copy of everything the user typed.
		renderHeader("first line\nsecond line", { currentTaskItem: { ...renamedItem, task: "first line" } })

		expect(screen.getByText("first line")).toBeInTheDocument()
		expect(screen.queryByText(/second line/)).toBeNull()
	})

	it("shows the stored title alone when it matches the prompt", () => {
		renderHeader("same text", { currentTaskItem: { ...renamedItem, task: "same text" } })

		expect(screen.getAllByText("same text")).toHaveLength(1)
	})

	it("shows the stored title in the collapsed header too", () => {
		// Collapsing hides the details card, so the one-line title is all that is
		// left — it must still be the renamed title, not the prompt.
		renderHeader("你好", { currentTaskItem: renamedItem, expanded: false })

		expect(screen.getByText("ABC")).toBeInTheDocument()
		expect(screen.queryByText("你好")).toBeNull()
	})
})

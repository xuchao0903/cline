import type { HistoryItem } from "@shared/HistoryItem"
import { VcsType, type WorkspaceRoot } from "@shared/multi-root/types"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import HistoryPreview from "./HistoryPreview"

const mocks = vi.hoisted(() => ({
	showTaskWithId: vi.fn(),
	renameTask: vi.fn(),
	moveTaskToProject: vi.fn(),
	state: {
		taskHistory: [] as HistoryItem[],
		workspaceRoots: [] as WorkspaceRoot[],
		primaryRootIndex: 0,
		platform: "linux" as const,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("@/hooks/useUsageCostVisibility", () => ({
	useUsageCostVisibility: () => () => true,
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		showTaskWithId: mocks.showTaskWithId,
		renameTask: mocks.renameTask,
		moveTaskToProject: mocks.moveTaskToProject,
	},
}))

const makeTask = (id: string, cwd?: string, ts = 1_000): HistoryItem => ({
	id,
	ts,
	task: `Task ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	cwdOnTaskInitialization: cwd,
})

const currentRoot = { path: "/home/u/proj", vcs: VcsType.Git } as WorkspaceRoot

/** Minimal DataTransfer stand-in: jsdom does not implement drag payloads. */
const makeDataTransfer = (taskId: string) => {
	const data = new Map<string, string>([["application/x-cline-task-id", taskId]])
	return {
		dropEffect: "",
		effectAllowed: "",
		getData: (type: string) => data.get(type) ?? "",
		setData: (type: string, value: string) => {
			data.set(type, value)
		},
	}
}

const renderPreview = (showHistoryView = vi.fn()) => {
	render(<HistoryPreview showHistoryView={showHistoryView} />)
	return showHistoryView
}

describe("HistoryPreview", () => {
	beforeEach(() => {
		window.localStorage.clear()
		mocks.showTaskWithId.mockReset().mockResolvedValue(undefined)
		mocks.renameTask.mockReset().mockResolvedValue(undefined)
		mocks.moveTaskToProject.mockReset().mockResolvedValue(undefined)
		mocks.state.taskHistory = []
		mocks.state.workspaceRoots = [currentRoot]
		mocks.state.primaryRootIndex = 0
	})

	it("shows the Recent header and empty state when there is no history", () => {
		renderPreview()

		expect(screen.getByText("Recent")).toBeInTheDocument()
		expect(screen.getByText("No recent tasks")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "View all history" })).toBeNull()
	})

	it("shows only the current project's tasks by default", () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere")]

		renderPreview()

		expect(screen.getByText("Task current")).toBeInTheDocument()
		expect(screen.queryByText("Task other")).toBeNull()
		// Both groups render as headers; the external one is collapsed.
		expect(screen.getByTitle("/home/u/proj")).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByTitle("/tmp/elsewhere")).toHaveAttribute("aria-expanded", "false")
	})

	it("expands a collapsed group when its header is clicked", () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere")]

		renderPreview()

		fireEvent.click(screen.getByTitle("/tmp/elsewhere"))

		expect(screen.getByText("Task other")).toBeInTheDocument()
		expect(screen.getByTitle("/tmp/elsewhere")).toHaveAttribute("aria-expanded", "true")

		fireEvent.click(screen.getByTitle("/tmp/elsewhere"))

		expect(screen.queryByText("Task other")).toBeNull()
		expect(screen.getByTitle("/tmp/elsewhere")).toHaveAttribute("aria-expanded", "false")
	})

	it("collapses the current project group after a manual toggle", () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere")]

		renderPreview()

		fireEvent.click(screen.getByTitle("/home/u/proj"))

		expect(screen.queryByText("Task current")).toBeNull()
		// The default for the other group does not change when the current one collapses.
		expect(screen.getByTitle("/tmp/elsewhere")).toHaveAttribute("aria-expanded", "false")
	})

	it("expands every group when no task belongs to the current workspace", () => {
		mocks.state.taskHistory = [makeTask("alpha", "/tmp/alpha"), makeTask("beta", "/tmp/beta")]

		renderPreview()

		expect(screen.getByText("Task alpha")).toBeInTheDocument()
		expect(screen.getByText("Task beta")).toBeInTheDocument()
		expect(screen.getByTitle("/tmp/alpha")).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByTitle("/tmp/beta")).toHaveAttribute("aria-expanded", "true")
	})

	it("expands every group when no workspace folder is open", () => {
		mocks.state.workspaceRoots = []
		mocks.state.taskHistory = [makeTask("solo", "/tmp/anything")]

		renderPreview()

		expect(screen.getByText("Task solo")).toBeInTheDocument()
		expect(screen.getByTitle("/tmp/anything")).toHaveAttribute("aria-expanded", "true")
	})

	it("renders unknown-cwd tasks under the Unknown Project group", () => {
		mocks.state.taskHistory = [makeTask("legacy"), makeTask("current", "/home/u/proj")]

		renderPreview()

		expect(screen.getByText("Task current")).toBeInTheDocument()
		expect(screen.queryByText("Task legacy")).toBeNull()
		expect(screen.getByRole("button", { name: /Unknown Project/ })).toHaveAttribute("aria-expanded", "false")

		fireEvent.click(screen.getByRole("button", { name: /Unknown Project/ }))

		expect(screen.getByText("Task legacy")).toBeInTheDocument()
	})

	it("caps each expanded group at five tasks with a View N more row", () => {
		mocks.state.taskHistory = Array.from({ length: 7 }, (_, index) => makeTask(`t${index}`, "/home/u/proj", 1_000 + index))
		const showHistoryView = renderPreview()

		expect(screen.getByText("Task t4")).toBeInTheDocument()
		expect(screen.queryByText("Task t5")).toBeNull()
		expect(screen.queryByText("Task t6")).toBeNull()

		fireEvent.click(screen.getByRole("button", { name: "View 2 more…" }))

		expect(showHistoryView).toHaveBeenCalledTimes(1)
	})

	it("opens the full history view from the View All button", () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]
		const showHistoryView = renderPreview()

		fireEvent.click(screen.getByRole("button", { name: "View all history" }))

		expect(showHistoryView).toHaveBeenCalledTimes(1)
	})

	it("resumes a task when its row is clicked", () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]

		renderPreview()

		fireEvent.click(screen.getByText("Task current"))

		expect(mocks.showTaskWithId).toHaveBeenCalledTimes(1)
		expect(mocks.showTaskWithId.mock.calls[0][0].value).toBe("current")
	})

	it("renames a conversation from the right-click menu", async () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]

		renderPreview()

		fireEvent.contextMenu(screen.getByText("Task current"))
		fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }))

		const input = screen.getByRole("textbox", { name: "Conversation title" })
		fireEvent.change(input, { target: { value: "Renamed task" } })
		fireEvent.keyDown(input, { key: "Enter" })

		await waitFor(() => expect(mocks.renameTask).toHaveBeenCalledTimes(1))
		expect(mocks.renameTask.mock.calls[0][0]).toMatchObject({ taskId: "current", title: "Renamed task" })
	})

	it("keeps the old title when the rename draft is cleared", async () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]

		renderPreview()

		fireEvent.contextMenu(screen.getByText("Task current"))
		fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }))

		const input = screen.getByRole("textbox", { name: "Conversation title" })
		fireEvent.change(input, { target: { value: "   " } })
		fireEvent.keyDown(input, { key: "Enter" })

		await waitFor(() => expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull())
		expect(mocks.renameTask).not.toHaveBeenCalled()
	})

	it("moves a conversation to another project from the right-click menu", async () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere")]

		renderPreview()

		fireEvent.contextMenu(screen.getByText("Task current"))
		// The conversation's own project is never offered as a target.
		expect(screen.queryByRole("menuitem", { name: "proj" })).toBeNull()
		fireEvent.click(screen.getByRole("menuitem", { name: "elsewhere" }))

		await waitFor(() => expect(mocks.moveTaskToProject).toHaveBeenCalledTimes(1))
		expect(mocks.moveTaskToProject.mock.calls[0][0]).toMatchObject({
			taskId: "current",
			projectPath: "/tmp/elsewhere",
		})
	})

	it("moves a conversation to a project when it is dropped on that group", async () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere")]

		renderPreview()

		const groupHeader = screen.getByTitle("/tmp/elsewhere")
		fireEvent.dragStart(screen.getByText("Task current"), {
			dataTransfer: makeDataTransfer("current"),
		})
		fireEvent.dragOver(groupHeader, { dataTransfer: makeDataTransfer("current") })
		fireEvent.drop(groupHeader, { dataTransfer: makeDataTransfer("current") })

		await waitFor(() => expect(mocks.moveTaskToProject).toHaveBeenCalledTimes(1))
		expect(mocks.moveTaskToProject.mock.calls[0][0]).toMatchObject({
			taskId: "current",
			projectPath: "/tmp/elsewhere",
		})
	})

	it("ignores drops on the unknown-project group, which has no folder", () => {
		mocks.state.taskHistory = [makeTask("legacy"), makeTask("current", "/home/u/proj")]

		renderPreview()

		const unknownGroup = screen.getByRole("button", { name: /Unknown Project/ })
		fireEvent.dragOver(unknownGroup, { dataTransfer: makeDataTransfer("current") })
		fireEvent.drop(unknownGroup, { dataTransfer: makeDataTransfer("current") })

		expect(mocks.moveTaskToProject).not.toHaveBeenCalled()
	})

	it("keeps an empty group for a project that lost its last conversation to a move", () => {
		window.localStorage.setItem("cline.historyRetainedProjects", JSON.stringify(["/tmp/elsewhere"]))
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]

		renderPreview()

		expect(screen.getByText("Task current")).toBeInTheDocument()
		expect(screen.getByTitle("/tmp/elsewhere")).toHaveAttribute("aria-expanded", "false")
		expect(screen.getByText("(0)")).toBeInTheDocument()
	})

	it("moves a conversation onto a retained (empty) project group", async () => {
		window.localStorage.setItem("cline.historyRetainedProjects", JSON.stringify(["/tmp/elsewhere"]))
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj")]

		renderPreview()

		const groupHeader = screen.getByTitle("/tmp/elsewhere")
		fireEvent.dragStart(screen.getByText("Task current"), { dataTransfer: makeDataTransfer("current") })
		fireEvent.dragOver(groupHeader, { dataTransfer: makeDataTransfer("current") })
		fireEvent.drop(groupHeader, { dataTransfer: makeDataTransfer("current") })

		await waitFor(() => expect(mocks.moveTaskToProject).toHaveBeenCalledTimes(1))
		expect(mocks.moveTaskToProject.mock.calls[0][0]).toMatchObject({
			taskId: "current",
			projectPath: "/tmp/elsewhere",
		})
	})

	it("remembers the source project when a drag empties it", async () => {
		mocks.state.taskHistory = [makeTask("current", "/home/u/proj"), makeTask("other", "/tmp/elsewhere", 2_000)]

		renderPreview()

		const groupHeader = screen.getByTitle("/tmp/elsewhere")
		fireEvent.dragStart(screen.getByText("Task current"), { dataTransfer: makeDataTransfer("current") })
		fireEvent.dragOver(groupHeader, { dataTransfer: makeDataTransfer("current") })
		fireEvent.drop(groupHeader, { dataTransfer: makeDataTransfer("current") })

		await waitFor(() => expect(mocks.moveTaskToProject).toHaveBeenCalledTimes(1))
		expect(window.localStorage.getItem("cline.historyRetainedProjects")).toContain("/home/u/proj")
	})
})

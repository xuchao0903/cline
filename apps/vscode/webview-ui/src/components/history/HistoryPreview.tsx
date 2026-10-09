import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useUsageCostVisibility } from "@/hooks/useUsageCostVisibility"
import { TaskServiceClient } from "@/services/grpc-client"
import HistoryItemMenu, { readDraggedTaskId, startHistoryTaskDrag } from "./HistoryItemMenu"
import HistoryTitleInput from "./HistoryTitleInput"
import { collectProjectTargets, defaultExpanded, groupHistoryByProject } from "./projectGroups"
import { forgetRetainedProject, getRetainedProjects } from "./retainedProjects"
import { useHistoryItemActions } from "./useHistoryItemActions"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

/** Per-group cap on the welcome preview; "View N more" opens the full history view. */
const HISTORY_GROUP_PREVIEW_LIMIT = 5

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory, workspaceRoots, primaryRootIndex, platform } = useExtensionState()
	const isCostVisible = useUsageCostVisibility()
	// Manual expand/collapse choices keyed by group path; groups without an
	// override fall back to defaultExpanded (current project expanded, other
	// projects collapsed — or everything expanded when nothing matches the
	// current workspace, so the preview is never an empty wall of headers).
	const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({})
	const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
	// Rename/move state is shared with the full history view; the preview reads
	// taskHistory straight from extension state, which the host refreshes.
	const { menu, renamingTaskId, openMenu, dismissMenu, beginRename, commitRename, cancelRename, moveToProject } =
		useHistoryItemActions()

	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	const validTasks = useMemo(() => taskHistory.filter((item) => item.ts && item.task), [taskHistory])

	const groups = useMemo(
		() =>
			groupHistoryByProject(validTasks, {
				workspaceRoots: workspaceRoots ?? [],
				primaryRootIndex: primaryRootIndex ?? 0,
				platform,
				// Retained projects keep an empty group after their last
				// conversation moved away, so the header survives as a drop target.
				retainedProjectPaths: getRetainedProjects(),
			}),
		[validTasks, workspaceRoots, primaryRootIndex, platform],
	)

	// A retained project that holds conversations again stops being pinned.
	useEffect(() => {
		for (const group of groups) {
			if (group.tasks.length > 0) {
				forgetRetainedProject(group.title)
			}
		}
	}, [groups])

	const hasCurrentGroup = groups.some((group) => group.isCurrent)

	const isGroupExpanded = useCallback(
		(key: string, isCurrent: boolean) => {
			const override = expandedOverrides[key]
			if (override !== undefined) {
				return override
			}
			return defaultExpanded(isCurrent, hasCurrentGroup)
		},
		[expandedOverrides, hasCurrentGroup],
	)

	const toggleGroup = useCallback(
		(key: string, isCurrent: boolean) => {
			setExpandedOverrides((previous) => ({ ...previous, [key]: !isGroupExpanded(key, isCurrent) }))
		},
		[isGroupExpanded],
	)

	const projectTargets = useMemo(
		() =>
			collectProjectTargets({
				workspaceRoots: workspaceRoots ?? [],
				historyPaths: [...validTasks.map((task) => task.cwdOnTaskInitialization), ...getRetainedProjects()],
				currentProjectPath: menu?.projectPath,
				platform,
			}),
		[workspaceRoots, validTasks, menu?.projectPath, platform],
	)

	const renderTask = (item: HistoryItem) => (
		<div
			className="history-preview-item"
			draggable={renamingTaskId !== item.id}
			key={item.id}
			onClick={() => handleHistorySelect(item.id)}
			onContextMenu={(event) => openMenu(event, item.id, item.cwdOnTaskInitialization)}
			onDragStart={(event) => startHistoryTaskDrag(event, item.id)}>
			<div className="history-task-content">
				{item.isFavorited && (
					<span
						aria-label="Favorited"
						className="codicon codicon-star-full"
						style={{
							color: "var(--vscode-button-background)",
							flexShrink: 0,
						}}
					/>
				)}
				{renamingTaskId === item.id ? (
					<HistoryTitleInput
						className="history-task-description"
						onCancel={cancelRename}
						onCommit={commitRename}
						value={item.task}
					/>
				) : (
					<div className="history-task-description ph-no-capture">{item.task}</div>
				)}
				{item.isLegacy && <span className="history-cost-chip">Legacy</span>}
			</div>
			<div className="history-meta-stack">
				<span className="history-date">{formatDate(item.ts)}</span>
				{item.totalCost != null && isCostVisible(item.apiProvider) && (
					<span className="history-cost-chip">${item.totalCost.toFixed(2)}</span>
				)}
			</div>
		</div>
	)

	return (
		<div style={{ flexShrink: 0 }}>
			{menu && (
				<HistoryItemMenu
					currentProjectPath={menu.projectPath}
					onDismiss={dismissMenu}
					onMoveToProject={(projectPath) => {
						const sourceProjectPath = groups.find((entry) =>
							entry.tasks.some((task) => task.id === menu.taskId),
						)?.title
						void moveToProject(menu.taskId, projectPath, sourceProjectPath)
					}}
					onRename={beginRename}
					platform={platform}
					position={{ x: menu.x, y: menu.y }}
					projects={projectTargets}
				/>
			)}
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 8px;
						padding: 10px 12px;
						display: flex;
						align-items: flex-start;
						gap: 12px;
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
						pointer-events: auto;
					}
					.history-task-content {
						flex: 1;
						display: flex;
						align-items: flex-start;
						gap: 8px;
						min-width: 0;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
						line-height: 1.4;
					}
					.history-meta-stack {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						flex-shrink: 0;
					}
					.history-date {
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
						white-space: nowrap;
					}
					.history-cost-chip {
						background-color: var(--vscode-badge-background);
						color: var(--vscode-badge-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.85em;
						font-weight: 500;
						white-space: nowrap;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					}
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
					.history-group-header {
						display: flex;
						align-items: center;
						gap: 6px;
						width: 100%;
						background: none;
						border: none;
						padding: 6px 4px;
						margin-top: 2px;
						cursor: pointer;
						text-align: left;
						border-radius: 4px;
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
					}
					.history-group-header:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						color: var(--vscode-foreground);
					}
					.history-group-header.history-drop-target {
						background-color: color-mix(in srgb, var(--vscode-button-background) 25%, transparent);
						color: var(--vscode-button-foreground);
						outline: 1px solid var(--vscode-button-background);
					}
					.history-group-label {
						font-weight: 600;
						text-transform: uppercase;
						letter-spacing: 0.02em;
						overflow: hidden;
						text-overflow: ellipsis;
						white-space: nowrap;
					}
					.history-group-count {
						font-weight: 400;
						color: var(--vscode-descriptionForeground);
						flex-shrink: 0;
					}
					.history-group-tasks {
						padding-left: 14px;
						border-left: 1px solid var(--vscode-panel-border);
						margin-left: 8px;
					}
					.history-view-more-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						margin-bottom: 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
					}
					.history-view-more-btn:hover {
						color: var(--vscode-foreground);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{
							marginRight: "4px",
							transform: "scale(0.9)",
						}}
					/>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent
					</span>
				</div>
				{validTasks.length > 0 && (
					<button
						aria-label="View all history"
						className="history-view-all-btn"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<span className="codicon codicon-chevron-right" />
					</button>
				)}
			</div>

			<div className="px-4">
				{validTasks.length > 0 ? (
					groups.map((group) => {
						const expanded = isGroupExpanded(group.key, group.isCurrent)
						const visibleTasks = expanded ? group.tasks.slice(0, HISTORY_GROUP_PREVIEW_LIMIT) : []
						const hiddenCount = expanded ? group.tasks.length - visibleTasks.length : 0
						return (
							<div className="history-group" key={group.key || "unknown"}>
								<button
									aria-expanded={expanded}
									className={`history-group-header${dropTargetPath === group.title ? " history-drop-target" : ""}`}
									onClick={() => toggleGroup(group.key, group.isCurrent)}
									onDragLeave={() => setDropTargetPath(null)}
									onDragOver={(event) => {
										if (!group.title || !readDraggedTaskId(event)) {
											return
										}
										// Without preventDefault the browser refuses the drop.
										event.preventDefault()
										event.dataTransfer.dropEffect = "move"
										setDropTargetPath(group.title)
									}}
									onDrop={(event) => {
										const taskId = readDraggedTaskId(event)
										setDropTargetPath(null)
										if (!group.title || !taskId) {
											return
										}
										event.preventDefault()
										const sourceProjectPath = groups.find((entry) =>
											entry.tasks.some((task) => task.id === taskId),
										)?.title
										void moveToProject(taskId, group.title, sourceProjectPath)
									}}
									title={group.title}
									type="button">
									<span className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
									<span className="codicon codicon-folder" />
									<span className="history-group-label">{group.label}</span>
									<span className="history-group-count">({group.tasks.length})</span>
								</button>
								{expanded && (
									<div className="history-group-tasks">
										{visibleTasks.map(renderTask)}
										{hiddenCount > 0 && (
											<button
												className="history-view-more-btn"
												onClick={() => showHistoryView()}
												type="button">
												View {hiddenCount} more…
											</button>
										)}
									</div>
								)}
							</div>
						)
					})
				) : (
					<div
						style={{
							textAlign: "center",
							color: "var(--vscode-descriptionForeground)",
							fontSize: "var(--vscode-font-size)",
							padding: "10px 0",
						}}>
						No recent tasks
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)

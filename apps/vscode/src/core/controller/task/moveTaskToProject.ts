import { Empty } from "@shared/proto/cline/common"
import { MoveTaskToProjectRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

export async function moveTaskToProject(controller: Controller, request: MoveTaskToProjectRequest): Promise<Empty> {
	if (!request.taskId) {
		Logger.error(`[moveTaskToProject] Invalid request: taskId missing`)
		return Empty.create({})
	}

	try {
		await controller.moveTaskToProject(request.taskId, request.projectPath)
		return Empty.create({})
	} catch (error) {
		Logger.error("Error in moveTaskToProject:", error)
		throw error
	}
}

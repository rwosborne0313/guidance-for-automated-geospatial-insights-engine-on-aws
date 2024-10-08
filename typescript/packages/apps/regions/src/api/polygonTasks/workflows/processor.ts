/*
 *  Copyright Amazon.com Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';

import type {
	CreatePolygonRequestWithRegionIdBody,
	EditPolygonRequestWithIdBody,
	TaskBatch,
	TaskBatchProgress
} from '../../../common/tasks/schemas.js';
import { PolygonTaskService } from "../service.js";
import { PolygonService } from "../../polygons/service.js";
import { Polygon } from "../../polygons/schemas.js";
import { TaskItemService } from "../../../common/taskItems/service.js";
import { TaskItemResource } from "../../../common/taskItems/schemas.js";
import { WorkflowAction } from "../../../common/tasks/workflows.interfaces.js";

export class PolygonTaskWorkflowProcessor implements WorkflowAction {

	public constructor(
		private readonly log: FastifyBaseLogger,
		private readonly polygonService: PolygonService,
		private readonly polygonTaskService: PolygonTaskService,
		private readonly polygonTaskItemService: TaskItemService,
		private readonly concurrencyLimit: number
	) {
	}

	// Process create Items received on the SQS queue
	public async process(batch: TaskBatch): Promise<void> {
		this.log.debug(`PolygonTaskCreateWorkflow> process> task:${JSON.stringify(batch)}`);

		// update the overall task status to inProgress
		await this.polygonTaskService.updateTaskStatus(batch.taskId, 'inProgress');

		// process task items
		const taskBatchProgress = await this.processTaskBatch(batch);

		// update task progress
		await this.polygonTaskService.updateTaskProgress(taskBatchProgress);

		// update the overall task status to success
		// (this will attempt to update the status but the query condition will guard this update to not update the status if the batches have not been completed)
		await this.polygonTaskService.updateTaskStatus(batch.taskId, 'success');

		this.log.debug(`PolygonTaskCreateWorkflow> process> exit:${JSON.stringify(taskBatchProgress)}`);
	}

	private async processTaskBatch(batch: TaskBatch): Promise<TaskBatchProgress> {
		this.log.debug(`PolygonTaskCreateWorkflow> processTaskItems> task:${JSON.stringify(batch)}`);

		const futures: Promise<TaskItemResource>[] = [];
		let succeededItems = 0;
		let failedItems = 0;
		const limit = pLimit(this.concurrencyLimit);
		for (const a of batch.items) {
			futures.push(
				limit(async () => {
					// create a minimal taskItem resource
					let taskItem: TaskItemResource = {
						name: a.name,
						taskId: batch.taskId,
					};

					// try to create an activity
					try {
						// this is where we can control the action needed to be performed in this case, it could an action to create or update an activity entity
						let actionResponse: Polygon;
						if (batch.type === 'create') {
							const { regionId, ...request } = a as CreatePolygonRequestWithRegionIdBody;
							actionResponse = await this.polygonService.create(batch.securityContext, regionId, request);
						} else if (batch.type === 'update') {
							const { id, ...request } = a as EditPolygonRequestWithIdBody;
							actionResponse = await this.polygonService.update(batch.securityContext, id, request);
						} else {
							throw Error('unknown task action');
						}

						// if we succeed, update the status and activity Id on the taskItem
						taskItem.status = 'success';
						taskItem.resourceId = actionResponse.id;

						// to avoid unnecessary iterations i.e. map() etc., we can optimize this by keep track of counters within the same loop
						succeededItems += 1;
					} catch (error) {
						const e = error as Error;

						// if we fail we update the status and statusMessage on the taskItem
						taskItem.status = 'failure';
						taskItem.statusMessage = e.message;

						failedItems += 1;

						this.log.debug(`PolygonTaskCreateWorkflow> processTaskItems> error: ${e.name}: ${e.message}`);
					}

					return taskItem;
				})
			);
		}
		const taskItems = await Promise.all(futures);

		// to optimize write to ddb, we will do a transaction write of all task items at once
		await this.polygonTaskItemService.createBulk(taskItems);

		// once we are done processing the items in this batch, we create a "batch progress report" and return it
		const batchProgress = {
			taskId: batch.taskId,
			totalItems: taskItems.length,
			itemsFailed: failedItems,
			itemsSucceeded: succeededItems,
		};

		this.log.debug(`PolygonTaskCreateWorkflow> processTaskItems> exit:${JSON.stringify(batchProgress)}`);

		return batchProgress;
	}
}

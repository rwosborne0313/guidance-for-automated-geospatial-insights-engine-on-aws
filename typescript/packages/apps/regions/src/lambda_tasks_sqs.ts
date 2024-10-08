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

import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import type { AwilixContainer } from 'awilix';
import { PolygonTaskWorkflowProcessor } from "./api/polygonTasks/workflows/processor.js";
import { TaskBatch } from "./common/tasks/schemas.js";
import { RegionTaskWorkflowProcessor } from "./api/regionTasks/workflows/processor.js";

const app: FastifyInstance = await buildApp();
const di: AwilixContainer = app.diContainer;

const polygonTaskWorkflowProcessor: PolygonTaskWorkflowProcessor = di.resolve('polygonTaskWorkflowProcessor');
const regionTaskWorkflowProcessor: RegionTaskWorkflowProcessor = di.resolve('regionTaskWorkflowProcessor');

export const handler = async (event: SQSEvent, _context: Context): Promise<SQSBatchResponse> => {
	app.log.debug(`SQS> handler> in> ${JSON.stringify(event)}`);

	const response: SQSBatchResponse = { batchItemFailures: [] };
	if (event?.Records) {
		for (const r of event.Records) {
			app.log.debug(`SQS> handler> start messageId: ${r.messageId} record: ${JSON.stringify(r)}`);

			if (r.eventSource !== 'aws:sqs') {
				app.log.warn(`SQS> handler> ignoring non-sqs events: ${JSON.stringify(r)}`);
				continue;
			}
			const messageType = r.messageAttributes?.['messageType']?.stringValue;
			const task: TaskBatch = JSON.parse(r.body);

			switch (messageType) {
				case 'PolygonTask:create':
					await polygonTaskWorkflowProcessor.process(task);
					break;
				case 'PolygonTask:update':
					await polygonTaskWorkflowProcessor.process(task);
					break;
				case 'RegionTask:create':
					await regionTaskWorkflowProcessor.process(task);
					break;
				case 'RegionTask:update':
					await regionTaskWorkflowProcessor.process(task);
					break;
				default:
					app.log.warn(`SQS> handler>  ignoring un-recognized sqs event`);
			}
		}
	}

	app.log.debug(`SQS> handler> exit response: ${JSON.stringify(response)}`);
	return response;
};

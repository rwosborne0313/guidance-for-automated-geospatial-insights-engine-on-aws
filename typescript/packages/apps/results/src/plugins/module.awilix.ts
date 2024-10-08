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

import { Cradle, diContainer, FastifyAwilixOptions, fastifyAwilixPlugin } from '@fastify/awilix';
import { asFunction, Lifetime } from 'awilix';
import pkg from 'aws-xray-sdk';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { RegionsClient, StacServerClient } from '@agie/clients';
import { EventPublisher, RESULTS_EVENT_SOURCE } from '@agie/events';
import { Invoker } from '@agie/lambda-invoker';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient, TranslateConfig } from '@aws-sdk/lib-dynamodb';
import { EventProcessor } from '../events/eventProcessor.js';
import { StacUtil } from '../utils/stacUtil.js';
import { ResultsService } from '../api/results/service.js';
import { ResultsRepository } from '../api/results/repository.js';
import { DynamoDbUtils } from '@agie/dynamodb-utils';
import { ApiAuthorizer } from '@agie/rest-api-authorizer';
import { VerifiedPermissionsClient } from '@aws-sdk/client-verifiedpermissions';

const { captureAWSv3Client } = pkg;

declare module '@fastify/awilix' {
	interface Cradle {
		eventProcessor: EventProcessor;
		eventBridgeClient: EventBridgeClient;
		dynamoDbUtils: DynamoDbUtils;
		dynamoDBDocumentClient: DynamoDBDocumentClient;
		s3Client: S3Client;
		secretsManagerClient: SecretsManagerClient;
		ssmClient: SSMClient;
		lambdaClient: LambdaClient;
		snsClient: SNSClient;
		stacServerClient: StacServerClient;
		regionsClient: RegionsClient;
		stacUtil: StacUtil;
		eventPublisher: EventPublisher;
		resultsRepository: ResultsRepository;
		lambdaInvoker: Invoker;
		resultsService: ResultsService;
		apiAuthorizer: ApiAuthorizer;
		avpClient: VerifiedPermissionsClient;
	}
}

class VerifiedPermissionsClientFactory {
	public static create(region: string): VerifiedPermissionsClient {
		return captureAWSv3Client(
			new VerifiedPermissionsClient({
				region,
			})
		);
	}
}

class DynamoDBDocumentClientFactory {
	public static create(region: string): DynamoDBDocumentClient {
		const ddb = captureAWSv3Client(new DynamoDBClient({ region }));
		const marshallOptions = {
			convertEmptyValues: false,
			removeUndefinedValues: true,
			convertClassInstanceToMap: false,
		};
		const unmarshallOptions = {
			wrapNumbers: false,
		};
		const translateConfig: TranslateConfig = { marshallOptions, unmarshallOptions };
		const dbc = DynamoDBDocumentClient.from(ddb, translateConfig);
		return dbc;
	}
}

class EventBridgeClientFactory {
	public static create(region: string | undefined): EventBridgeClient {
		const eb = captureAWSv3Client(new EventBridgeClient({ region }));
		return eb;
	}
}

class S3ClientFactory {
	public static create(region: string): S3Client {
		const s3 = captureAWSv3Client(new S3Client({ region }));
		return s3;
	}
}

class SSMClientFactory {
	public static create(region: string): SSMClient {
		const ssm = captureAWSv3Client(new SSMClient({ region }));
		return ssm;
	}
}

class SecretsManagerClientFactory {
	public static create(region: string): SecretsManagerClient {
		const sm = captureAWSv3Client(new SecretsManagerClient({ region }));
		return sm;
	}
}

class LambdaClientFactory {
	public static create(region: string): LambdaClient {
		return captureAWSv3Client(new LambdaClient({ region }));
	}
}

class SNSClientFactory {
	public static create(region: string): SNSClient {
		return captureAWSv3Client(new SNSClient({ region }));
	}
}

const registerContainer = (app?: FastifyInstance) => {
	const commonInjectionOptions = {
		lifetime: Lifetime.SINGLETON,
	};

	const awsRegion = process.env['AWS_REGION'];
	const eventBusName = process.env['EVENT_BUS_NAME'];
	const bucketName = process.env['BUCKET_NAME'];
	const tableName = process.env['TABLE_NAME'];
	const stacServerTopicArn = process.env['STAC_SERVER_TOPIC_ARN'];
	const stacApiEndpoint = process.env['STAC_API_ENDPOINT'];
	const regionsFunctionName = process.env['REGIONS_FUNCTION_NAME'];
	const userPoolId = process.env['USER_POOL_ID'];
	const policyStoreId = process.env['POLICY_STORE_ID'];
	const clientId = process.env['CLIENT_ID'];

	diContainer.register({
		// Clients
		eventBridgeClient: asFunction(() => EventBridgeClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		dynamoDBDocumentClient: asFunction(() => DynamoDBDocumentClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		dynamoDbUtils: asFunction((c: Cradle) => new DynamoDbUtils(app.log, c.dynamoDBDocumentClient), {
			...commonInjectionOptions,
		}),

		s3Client: asFunction(() => S3ClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		ssmClient: asFunction(() => SSMClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		secretsManagerClient: asFunction(() => SecretsManagerClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		snsClient: asFunction(() => SNSClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		eventPublisher: asFunction((container: Cradle) => new EventPublisher(app.log, container.eventBridgeClient, eventBusName, RESULTS_EVENT_SOURCE), {
			...commonInjectionOptions,
		}),

		lambdaClient: asFunction(() => LambdaClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		stacServerClient: asFunction(
			(container: Cradle) =>
				new StacServerClient(
					app.log,
					container.snsClient,
					stacServerTopicArn,
					stacApiEndpoint,
					awsRegion
				),
			{
				...commonInjectionOptions,
			}
		),

		lambdaInvoker: asFunction((container: Cradle) => new Invoker(app.log, container.lambdaClient), {
			...commonInjectionOptions,
		}),

		regionsClient: asFunction((container: Cradle) => new RegionsClient(app.log, container.lambdaInvoker, regionsFunctionName), {
			...commonInjectionOptions,
		}),

		stacUtil: asFunction((container: Cradle) => new StacUtil(app.log, container.s3Client, bucketName), {
			...commonInjectionOptions,
		}),

		// Event Processors
		eventProcessor: asFunction((container) => new EventProcessor(app.log, container.resultsService, container.stacServerClient, container.stacUtil), {
			...commonInjectionOptions,
		}),

		resultsService: asFunction((container) => new ResultsService(app.log, container.resultsRepository, container.eventPublisher), {
			...commonInjectionOptions,
		}),

		// Repositories
		resultsRepository: asFunction((container) => new ResultsRepository(app.log, container.dynamoDBDocumentClient, tableName), {
			...commonInjectionOptions,
		}),

		avpClient: asFunction(() => VerifiedPermissionsClientFactory.create(awsRegion), {
			...commonInjectionOptions,
		}),

		apiAuthorizer: asFunction((c: Cradle) => new ApiAuthorizer(app.log, c.avpClient, policyStoreId, userPoolId, clientId), {
			...commonInjectionOptions,
		}),
	});
};

export default fp<FastifyAwilixOptions>(async (app: FastifyInstance): Promise<void> => {
	// first register the DI plugin
	await app.register(fastifyAwilixPlugin, {
		disposeOnClose: true,
		disposeOnResponse: false,
	});

	registerContainer(app);
});

export { registerContainer };

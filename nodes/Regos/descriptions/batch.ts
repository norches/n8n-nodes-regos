import type { INodeProperties } from 'n8n-workflow';

// Hand-written UI for the REGOS /batch endpoint (excluded from codegen, see ADR-0004).
// Up to 50 steps per request; ${stepKey.result.prop} placeholders reference earlier
// step results and are passed through to REGOS untouched.
export const batchProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['batch'] } },
		options: [
			{
				name: 'Execute',
				value: 'execute',
				action: 'Execute a batch of API calls',
				description: 'Run up to 50 REGOS API calls in one request',
			},
		],
		default: 'execute',
	},
	{
		displayName: 'Input Mode',
		name: 'inputMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['batch'] } },
		options: [
			{ name: 'Steps', value: 'steps', description: 'Define batch steps in the UI' },
			{ name: 'JSON', value: 'json', description: 'Provide the raw batch request body as JSON' },
		],
		default: 'steps',
	},
	{
		displayName: 'Stop on Error',
		name: 'stopOnError',
		type: 'boolean',
		default: false,
		description: 'Whether to stop executing the batch at the first failed step',
		displayOptions: { show: { resource: ['batch'], inputMode: ['steps'] } },
	},
	{
		displayName: 'Steps',
		name: 'steps',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Step',
		default: {},
		displayOptions: { show: { resource: ['batch'], inputMode: ['steps'] } },
		options: [
			{
				name: 'step',
				displayName: 'Step',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						required: true,
						description:
							'Unique step key. Later steps can reference this step\'s result with placeholders like ${myKey.result.new_id}.',
					},
					{
						displayName: 'Path',
						name: 'path',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'e.g. Producer/Add',
						description: 'REGOS method path exactly as in the API docs (casing matters)',
					},
					{
						displayName: 'Payload',
						name: 'payload',
						type: 'json',
						default: '{}',
						description: 'JSON body for this step',
					},
				],
			},
		],
	},
	{
		displayName: 'Request JSON',
		name: 'requestJson',
		type: 'json',
		default: '{\n\t"stop_on_error": false,\n\t"requests": []\n}',
		description: 'Full batch request body, sent to REGOS as-is',
		displayOptions: { show: { resource: ['batch'], inputMode: ['json'] } },
	},
];

import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { toNodeError } from '../shared/GenericFunctions';
import { executeRegosNode } from '../shared/executor';
import { operationsMeta } from './generated/metadata';
import { nodeProperties } from './generated/properties';

export class RegosCrm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Regos CRM',
		name: 'regosCrm',
		icon: { light: 'file:regos.svg', dark: 'file:regos.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'REGOS CRM and loyalty: leads, deals, chats, tickets, customers, loyalty cards, campaigns',
		defaults: { name: 'Regos CRM' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'regosApi', required: true }],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Per-item continueOnFail handling lives in the shared executor; this outer
		// catch covers failures raised outside the item loop (e.g. parameter lookup).
		try {
			return await executeRegosNode(this, operationsMeta);
		} catch (error) {
			if (this.continueOnFail()) {
				return [[{ json: { error: (error as Error).message }, pairedItem: { item: 0 } }]];
			}
			throw toNodeError(this, error);
		}
	}
}

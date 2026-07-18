import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class RegosApi implements ICredentialType {
	name = 'regosApi';

	displayName = 'REGOS API';

	icon: Icon = { light: 'file:regos.svg', dark: 'file:regos.dark.svg' };

	documentationUrl = 'https://github.com/OWNER/n8n-nodes-regos?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Integration Key',
			name: 'integrationKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'The key segment of the gateway endpoint REGOS shows when you create a Local Integration (https://integration.regos.uz/gateway/out/{key}/v1/). Create one at regos.online → Business settings → Integrations.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://integration.regos.uz/gateway/out',
			description: 'Gateway base URL. Only change this if REGOS gives you a different gateway host.',
		},
	];

	// REGOS returns application errors as HTTP 200 with { ok: false, result: { error, description } },
	// so the test must fail on ok:false, not only on HTTP errors.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}/{{$credentials.integrationKey}}/v1',
			url: '/CurrentTimeStamp/Get',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json;charset=utf-8',
			},
			body: {},
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'ok',
					value: false,
					message: 'REGOS rejected the integration key — check the key and that the Local Integration is active',
				},
			},
		],
	};
}

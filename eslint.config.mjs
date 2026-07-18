import { config } from '@n8n/node-cli/eslint';

// scripts/ and tests/ are dev-time only and never published (package files = ["dist"]),
// so the community-node runtime rules do not apply to them.
export default [...config, { ignores: ['scripts/**', 'tests/**', 'dist/**', 'vitest.config.*'] }];

import type { Policy } from './types.ts';
export const defaultPolicy: Policy = { schemaVersion:'1.0', merchantId:'merchant_demo', version:'demo-conservative-v1', timezone:'UTC', quietHours:{start:21,end:8}, cooldownHours:24, maxContactsPerCase:2, minimumAmountMinor:100, channels:{simulatedEmail:true}, allowUpdateLink:true };

import type { NormalizedFailure, RawFailure } from './types.ts';
export function normalizeFailure(raw: RawFailure = {}): NormalizedFailure {
  const reason=(raw.reason ?? '').toLowerCase(); const source=(raw.source ?? '').toLowerCase();
  const customerMap: Record<string, NormalizedFailure['remedy']>={insufficient_funds:'fund_account',expired_card:'update_method',card_blocked:'update_method',mandate_cancelled:'update_method'};
  let ownership:NormalizedFailure['ownership']='unknown', remedy:NormalizedFailure['remedy']='manual_review', confidence:NormalizedFailure['confidence']='low';
  if (reason in customerMap) { ownership='customer'; remedy=customerMap[reason]!; confidence='high'; }
  else if (['gateway_timeout','issuer_unavailable'].includes(reason)) { ownership='issuer_or_gateway'; remedy='wait_for_platform_retry'; confidence='high'; }
  else if (['configuration_error','integration_error'].includes(reason)) { ownership='merchant'; remedy='fix_integration'; confidence='high'; }
  const sourceOwner:Record<string,NormalizedFailure['ownership']>={customer:'customer',business:'merchant',gateway:'issuer_or_gateway',razorpay:'razorpay'};
  const contradictory=Boolean(sourceOwner[source] && ownership!=='unknown' && sourceOwner[source]!==ownership);
  if (contradictory) { ownership='unknown'; remedy='manual_review'; confidence='low'; }
  return {ownership,remedy,confidence,contradictory,raw:{...raw}};
}

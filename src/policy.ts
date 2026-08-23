import { ACTIONS, type Action, type Policy, type RecoveryCase, type RecoveryEvent } from './types.ts';
const CONTACT:Action[]=['SEND_GENTLE_REMINDER','SEND_ACTION_REQUIRED','SURFACE_PAYMENT_UPDATE_LINK'];
function quiet(now:string,p:Policy){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now))); return p.quietHours.start>p.quietHours.end ? hour>=p.quietHours.start||hour<p.quietHours.end : hour>=p.quietHours.start&&hour<p.quietHours.end;}
export function evaluate(c:RecoveryCase,e:RecoveryEvent,p:Policy,now:string):{eligible:Action[];reasons:string[]}{
  if(e.type==='invalid'||e.identityConsistent===false||c.state==='AMBIGUOUS') return {eligible:['SUPPRESS'],reasons:['FAIL_CLOSED_AMBIGUOUS_OR_INVALID']};
  if(e.suppressed||!e.consent) return {eligible:['SUPPRESS'],reasons:['SUPPRESSION_OR_NO_CONSENT']};
  if(c.state==='RECOVERED'||c.state==='CLOSED_CANCELLED') return {eligible:['SUPPRESS'],reasons:['CASE_TERMINAL']};
  if(c.failure?.ownership==='unknown'||c.failure?.contradictory) return {eligible:['WAIT','ESCALATE_TO_MERCHANT'],reasons:['UNKNOWN_OR_CONTRADICTORY_FAILURE']};
  if(c.failure?.remedy==='fix_integration') return {eligible:['ESCALATE_TO_MERCHANT'],reasons:['MERCHANT_REMEDY_REQUIRED']};
  if(c.state==='OPEN_HALTED') return {eligible:['ESCALATE_TO_MERCHANT'],reasons:['SUBSCRIPTION_HALTED']};
  if(c.failure?.remedy==='wait_for_platform_retry'&&e.retryAt&&new Date(e.retryAt)>new Date(now)) return {eligible:['WAIT'],reasons:['PLATFORM_RETRY_IMMINENT']};
  const blocked=!e.contactAvailable||!p.channels.simulatedEmail||quiet(now,p)||c.contactCount>=p.maxContactsPerCase||c.amountMinor<p.minimumAmountMinor||(c.lastContactAt!==undefined&&new Date(now).getTime()-new Date(c.lastContactAt).getTime()<p.cooldownHours*3600000);
  if(blocked) return {eligible:['WAIT'],reasons:['CONTACT_GUARDRAIL']};
  const eligible:Action[]=['WAIT'];
  if(c.failure?.remedy==='fund_account') eligible.push('SEND_GENTLE_REMINDER');
  if(c.failure?.remedy==='update_method') { eligible.push('SEND_ACTION_REQUIRED'); if(p.allowUpdateLink&&e.trustedUpdateLinkAvailable) eligible.push('SURFACE_PAYMENT_UPDATE_LINK'); }
  return {eligible,reasons:['ACTION_ALLOWED']};
}
export function selectAction(eligible:Action[]):Action { for(const a of ['SUPPRESS','ESCALATE_TO_MERCHANT','SURFACE_PAYMENT_UPDATE_LINK','SEND_ACTION_REQUIRED','SEND_GENTLE_REMINDER','WAIT'] as Action[]) if(eligible.includes(a)) return a; return 'SUPPRESS'; }
export function prohibited(eligible:Action[]):Action[]{return ACTIONS.filter(a=>!eligible.includes(a));}
export function isContact(a:Action){return CONTACT.includes(a);}

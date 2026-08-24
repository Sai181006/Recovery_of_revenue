import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { scenarios } from '../fixtures/scenarios.ts';
import { defaultPolicy } from './default-policy.ts';
import { evaluate } from './evaluation.ts';
import { MerchantExperience, type MerchantRole } from './experience.ts';
import { Pipeline } from './pipeline.ts';
import { readiness } from './readiness.ts';
import { Store } from './store.ts';
import { ACTIONS, type Action } from './types.ts';
import { WebhookProcessor } from './webhook.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dataPath = process.env.DATA_PATH ?? 'data/recovery.sqlite';
const publicDir = join(process.cwd(), 'public');

mkdirSync('data', { recursive: true });
const store = new Store(dataPath);
const pipeline = new Pipeline(store, defaultPolicy);
for (const scenario of scenarios) for (const event of scenario.events) pipeline.process(event, scenario.now);
const experience = new MerchantExperience(store);
const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const webhook = new WebhookProcessor(store, pipeline, secret, {
  merchantId: 'merchant_demo', consent: false, suppressed: false,
  contactAvailable: false, trustedUpdateLinkAvailable: false,
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
};
const staticTypes: Record<string, string> = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
function serveStatic(res: ServerResponse, pathname: string) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html','app.css','app.js','mark.svg'].includes(file)) return false;
  try { const body=readFileSync(join(publicDir,file)); res.statusCode=200; res.setHeader('content-type',staticTypes[extname(file)]??'application/octet-stream'); res.setHeader('cache-control',file==='index.html'?'no-cache':'public, max-age=3600'); res.end(body); return true; } catch { return false; }
}
async function rawBody(req: IncomingMessage) { const chunks:Buffer[]=[]; let size=0; for await(const chunk of req){const value=Buffer.from(chunk);size+=value.length;if(size>1_000_000)throw new Error('payload too large');chunks.push(value)} return Buffer.concat(chunks) }
const role=(req:IncomingMessage)=>(Array.isArray(req.headers['x-merchant-role'])?req.headers['x-merchant-role'][0]:req.headers['x-merchant-role']) as MerchantRole;
const errorStatus=(message:string)=>message==='forbidden'?403:message.includes('not found')?404:message.includes('terminal')||message.includes('not eligible')?409:400;

export const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??'/','http://localhost'), pathname=url.pathname;
  if(req.method==='GET'&&serveStatic(res,pathname))return;
  if(req.method==='POST'&&pathname==='/webhooks/razorpay'){const raw=await rawBody(req);const result=webhook.process(raw,{'x-razorpay-event-id':Array.isArray(req.headers['x-razorpay-event-id'])?req.headers['x-razorpay-event-id'][0]:req.headers['x-razorpay-event-id'],'x-razorpay-signature':Array.isArray(req.headers['x-razorpay-signature'])?req.headers['x-razorpay-signature'][0]:req.headers['x-razorpay-signature']});json(res,result.processingStatus==='REJECTED'?401:['PROCESSED','DUPLICATE'].includes(result.processingStatus)?202:422,result);return}
  const control=pathname.match(/^\/cases\/([^/]+)\/(suppress|override)$/);if(req.method==='POST'&&control){const caseId=decodeURIComponent(control[1]!);if(control[2]==='suppress'){json(res,200,experience.suppress(caseId,role(req),new Date().toISOString()));return}const body=JSON.parse((await rawBody(req)).toString('utf8')) as {action?:string};if(!ACTIONS.includes(body.action as Action))throw new Error('invalid action');json(res,200,experience.override(caseId,body.action as Action,role(req),new Date().toISOString()));return}
  const delivery=pathname.match(/^\/outbox\/([^/]+)\/deliver$/);if(req.method==='POST'&&delivery){json(res,200,experience.markDelivered(decodeURIComponent(delivery[1]!),role(req),new Date().toISOString()));return}
  if(pathname==='/health'){json(res,200,readiness({webhookSecret:secret,publicBaseUrl:process.env.PUBLIC_BASE_URL,modelProvider:process.env.MODEL_PROVIDER,modelName:process.env.MODEL_NAME,modelApiKey:process.env.MODEL_API_KEY}));return}
  if(pathname==='/evaluation'){json(res,200,evaluate());return}
  if(pathname==='/webhook-receipts'){json(res,200,store.webhookReceipts());return}
  if(pathname==='/cases'){json(res,200,experience.queue());return}
  if(pathname.startsWith('/cases/')){const view=store.view(decodeURIComponent(pathname.slice(7)));json(res,view.case?200:404,view);return}
  json(res,404,{error:'not_found'});
}catch(error){const message=error instanceof Error?error.message:'internal_error';json(res,message==='payload too large'?413:errorStatus(message),{error:message})}});
if(process.env.NODE_ENV!=='test')server.listen(port,host,()=>console.log(`Recovery workspace ready on ${host}:${port}`));

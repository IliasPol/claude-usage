import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ingest,projectRoots,summarize,timeWindow,totalTokens,DEFAULT_RATES} from './core.mjs';

const HOME=()=>path.join(os.homedir(),'.claude-usage-explorer');
const SUMMARY=()=>path.join(HOME(),'status-summary.json');
const SETTINGS=()=>path.join(HOME(),'settings.json');
const MAX_AGE=60_000;
const readJson=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return {};}};
const usd=n=>'$'+Number(n).toFixed(2);
const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
export function formatStatusLine(input,summary={}) {
  const cost=Number(input?.cost?.total_cost_usd);
  const session=Number.isFinite(cost)&&cost>=0?usd(cost):'—';
  const model=input?.model?.display_name||input?.model?.id||'Claude';
  const cycle=summary.cycle;
  const cycleText=cycle ? (cycle.unknownCostRequests ? `${usd(cycle.knownCost)}+` : usd(cycle.knownCost)) : '—';
  const tokens=cycle?compact(totalTokens(cycle)):'—';
  const status=summary.error?' (history unavailable)':'';
  return `${model}  │  Session ${session}  │  Cycle ${cycleText} est. · ${tokens} tokens${status}`;
}
export function computeSummary(now=Date.now(),settings=readJson(SETTINGS())){
  if(!Number.isInteger(settings.billingDay)||settings.billingDay<1||settings.billingDay>31) return {error:'Set billing date in TUI (B → Billing)'};
  const window=timeWindow('cycle',now,settings.billingDay,settings.billingTimeZone||'UTC',settings.billingHour||0,settings.billingMinute||0);
  const report=summarize(ingest(projectRoots()),window,{...DEFAULT_RATES,...(settings.rates||{})});
  return {cycle:report.overall,window,computedAt:now};
}
function cachedSummary(now=Date.now()){
  const existing=readJson(SUMMARY());
  const settings=readJson(SETTINGS());
  let stat;
  try{stat=fs.statSync(SETTINGS());}catch{}
  const settingsMtime=stat?.mtimeMs||0;
  if(existing.computedAt && now-existing.computedAt<MAX_AGE && existing.settingsMtime===settingsMtime) return existing;
  let result;
  try{result=computeSummary(now,settings);}catch(e){result={error:e.message};}
  result.computedAt=now;result.settingsMtime=settingsMtime;
  try{fs.mkdirSync(HOME(),{recursive:true,mode:0o700});fs.writeFileSync(SUMMARY(),JSON.stringify(result),{mode:0o600});}catch{}
  return result;
}
export async function runStatusLine(){
  // Claude Code passes a JSON status payload via stdin. Never log it or store it.
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2_000_000)break;}
  let input={};try{input=JSON.parse(raw);}catch{}
  process.stdout.write(formatStatusLine(input,cachedSummary())+'\n');
}
export function installStatusLine({settingsPath=path.join(os.homedir(),'.claude','settings.json'),force=false,scriptPath=fileURLToPath(new URL('../bin/claude-usage.mjs',import.meta.url))}={}){
  const settings=readJson(settingsPath);
  if(settings.statusLine && !force) throw new Error('Claude already has a statusLine configured. To replace it, run statusline-install --force (a backup will be saved).');
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
  if(fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath,settingsPath+'.claude-usage-backup-'+Date.now());
  // Node's executable resolved during install may be an asdf shim; prefer the current absolute Node executable.
  const quote=s=>`"${String(s).replace(/"/g,'\\"')}"`;
  settings.statusLine={type:'command',command:`${quote(process.execPath)} ${quote(scriptPath)} statusline`,padding:0};
  fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
  return settingsPath;
}

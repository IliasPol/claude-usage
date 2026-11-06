import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const day = 86400000;
export const DEFAULT_RATES = {
  // USD per million tokens. Indicative defaults, not an authoritative historical price table.
  'claude-opus-4': [15,75,18.75,1.5],
  'claude-opus-4-1': [15,75,18.75,1.5],
  'claude-opus-4-5': [5,25,6.25,0.5],
  'claude-opus-4-6': [5,25,6.25,0.5],
  'claude-sonnet-4': [3,15,3.75,0.3],
  'claude-sonnet-4-5': [3,15,3.75,0.3],
  'claude-sonnet-4-6': [3,15,3.75,0.3],
  // Official standard 5-minute-cache API rates (USD / million), checked 2026-11-05.
  'claude-sonnet-5-5': [2,10,2.5,0.1],
  'claude-sonnet-5': [2,10,2.5,0.2],
  'claude-opus-5-5': [4,20,5,0.2],
  'claude-opus-5': [5,25,6.25,0.5],
  'claude-haiku-5-5': [0.1,0.5,0.125,0.01],
  'claude-haiku-4-5': [1,5,1.25,0.1],
  'claude-3-7-sonnet': [3,15,3.75,0.3],
  'claude-3-5-sonnet': [3,15,3.75,0.3],
  'claude-3-5-haiku': [0.8,4,1,0.08],
};
const ZERO = () => ({ input:0, output:0, cacheWrite:0, cacheRead:0, requests:0, knownCost:0, unknownCostRequests:0 });
export function add(a,b) { for (const k of Object.keys(a)) a[k] += b[k] ?? 0; return a; }
export function totalTokens(a) { return a.input+a.output+a.cacheWrite+a.cacheRead; }
export function money(n) { return '$'+n.toFixed(4); }
export function number(n) { return Math.round(n).toLocaleString('en-US'); }
export function projectRoots(env=process.env,home=os.homedir()) {
  const roots = [env.CLAUDE_CONFIG_DIR, path.join(home,'.claude')].filter(Boolean).map(x=>path.resolve(x,'projects'));
  return [...new Set(roots)];
}
export function walk(dir, result=[], depth=0) {
  if(depth>12) return result;
  let items; try { items=fs.readdirSync(dir,{withFileTypes:true}); } catch { return result; }
  for(const item of items) {
    const f=path.join(dir,item.name);
    if(item.isDirectory()) walk(f,result,depth+1);
    else if(item.isFile() && item.name.endsWith('.jsonl')) result.push(f);
  }
  return result;
}
export function readLines(file,onRecord) {
  // Synchronous bounded-memory line iterator for portability; skips malformed and incomplete lines.
  const fd=fs.openSync(file,'r'); const buf=Buffer.allocUnsafe(128*1024); let carry=''; let bad=0;
  const decoder=new TextDecoder('utf-8');
  try { let n; while((n=fs.readSync(fd,buf,0,buf.length,null))>0) {
    carry += decoder.decode(buf.subarray(0,n),{stream:true});
    let pos; while((pos=carry.indexOf('\n'))!==-1) {
      const line=carry.slice(0,pos);carry=carry.slice(pos+1);
      if(!line.trim()) continue;
      try {onRecord(JSON.parse(line));} catch {bad++;}
    }
    // A single exceptionally large line is possible; keep it until newline, never truncate silently.
  }
  carry+=decoder.decode();
  if(carry.trim()) {try {onRecord(JSON.parse(carry));} catch {bad++;}}
  } finally {fs.closeSync(fd);} return bad;
}
export function sessionIdentity(file) {
  const name=path.basename(file,'.jsonl');
  const segments=file.split(path.sep);
  const idx=segments.lastIndexOf('subagents');
  return {id:idx>=0 ? segments[idx-1] : name, agent:idx>=0 ? name.replace(/^agent-/,'') : 'main', isSubagent:idx>=0};
}
function metrics(usage) {
  const u=usage||{};
  return {input:Number(u.input_tokens)||0,output:Number(u.output_tokens)||0,
    cacheWrite:Number(u.cache_creation_input_tokens)||0,cacheRead:Number(u.cache_read_input_tokens)||0,
    cacheWrite5m:Number(u.cache_creation?.ephemeral_5m_input_tokens)||0,cacheWrite1h:Number(u.cache_creation?.ephemeral_1h_input_tokens)||0};
}
function normalizeModel(model) {
  if(!model || typeof model!=='string' || model.startsWith('<')) return null;
  return model.replace(/-20\d{6}$/, '');
}
export function costFor(model,m,rates=DEFAULT_RATES) {
  const normalized=normalizeModel(model);const rate=normalized && rates[normalized];
  if(!rate) return null;
  // Prefer tier-specific cache creation counters when present; fallback to aggregate.
  const w5=Number(m.cacheWrite5m)||0,w1=Number(m.cacheWrite1h)||0;
  const writeCost=(w5||w1) ? w5*rate[2]+w1*(rate[4]??rate[2]*1.6) : m.cacheWrite*rate[2];
  return (m.input*rate[0]+m.output*rate[1]+writeCost+m.cacheRead*rate[3])/1e6;
}
export function parseFile(file, rates=DEFAULT_RATES) {
  const id=sessionIdentity(file);const requests=new Map();let title=null,cwd=null,start=null,end=null,sessionId=null,agentName=null;
  const bad=readLines(file,r=>{
    if(!r || typeof r!=='object') return;
    if(typeof r.cwd==='string') cwd=r.cwd;
    if(typeof r.sessionId==='string') sessionId=r.sessionId;
    if(id.isSubagent&&!agentName){const candidate=r.agentType||r.agentName||r.agent_type||r.agent_name;if(typeof candidate==='string'&&candidate.trim()&&candidate.length<=100)agentName=candidate.trim();}
    const ts=Date.parse(r.timestamp);
    if(Number.isFinite(ts)) {start=Math.min(start??ts,ts);end=Math.max(end??ts,ts);}
    if(!title && r.type==='user') {
      const c=r.message?.content;
      const s=typeof c==='string' ? c : Array.isArray(c)? c.filter(x=>x?.type==='text').map(x=>x.text).join(' '):'';
      const trimmed=s?.replace(/\s+/g,' ').trim();
      if(trimmed && !trimmed.startsWith('<') && !trimmed.startsWith('[Request interrupted') && !trimmed.startsWith('<command-name>')) title=trimmed.slice(0,110);
    }
    if(r.type==='custom-title' && typeof r.customTitle==='string') title=r.customTitle;
    if(r.type!=='assistant') return;
    const msg=r.message||{};if(!msg.usage || !msg.id) return;
    const model=normalizeModel(msg.model);if(!model) return;
    const m=metrics(msg.usage);
    const key=String(msg.id);
    const prev=requests.get(key);
    // Multiple records for the same message ID are snapshots, not separate requests.
    // Preserve the highest observed counters, including streaming partial updates.
    if(prev) {
      for(const k of ['input','output','cacheWrite','cacheRead','cacheWrite5m','cacheWrite1h']) prev[k]=Math.max(prev[k],m[k]);
      if(Number.isFinite(ts)) prev.timestamp=Math.min(prev.timestamp??ts,ts);
    } else requests.set(key,{...m,model,timestamp:Number.isFinite(ts)?ts:null});
  });
  return {file,sessionId:sessionId||id.id,agent:id.agent,isSubagent:id.isSubagent,agentName,title,cwd,start,end,bad,requests:[...requests.values()]};
}

// Cache derived metadata and token counters only. Never persist transcript text beyond
// the short session title. Cache invalidates when file size/mtime changes.
const CACHE_VERSION=4;
const cacheDir=()=>path.join(os.homedir(),'.claude-usage-explorer','cache-v3');
function readCachedFile(file){
  const st=fs.statSync(file);
  const key=Buffer.from(file).toString('hex');
  // A filename derived from SHA-256 avoids excessively long paths.
  const name=hashPath(file)+'.json';
  const dest=path.join(cacheDir(),name);
  try {const obj=JSON.parse(fs.readFileSync(dest,'utf8'));
    if(obj.version===CACHE_VERSION && obj.size===st.size && obj.mtime===st.mtimeMs)return obj.parsed;
  } catch {}
  const parsed=parseFile(file);
  try {fs.mkdirSync(cacheDir(),{recursive:true,mode:0o700});
    const tmp=dest+'.'+process.pid+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({version:CACHE_VERSION,size:st.size,mtime:st.mtimeMs,parsed}),{mode:0o600});
    fs.renameSync(tmp,dest);
  }catch{};
  return parsed;
}
function hashPath(s){return createHash('sha256').update(s).digest('hex');}

export function ingest(roots,rates=DEFAULT_RATES) {
  const files=[...new Set(roots.flatMap(r=>walk(r)))];const sessions=new Map();let malformed=0;
  for(const file of files) {
    let parsed;try {parsed=readCachedFile(file);} catch {malformed++;continue;}
    malformed+=parsed.bad;
    // Distinct files are attributed by session and agent, not only by filename.
    const key=parsed.sessionId;
    let s=sessions.get(key);
    if(!s) {s={id:key,title:null,cwd:null,start:null,end:null,agents:new Map(),files:[]};sessions.set(key,s);}
    s.files.push(file);s.title=s.title||parsed.title;s.cwd=s.cwd||parsed.cwd;
    if(parsed.start!==null) s.start=Math.min(s.start??parsed.start,parsed.start);
    if(parsed.end!==null) s.end=Math.max(s.end??parsed.end,parsed.end);
    let agent=s.agents.get(parsed.agent);
    if(!agent) {agent={id:parsed.agent,name:parsed.agentName||null,requests:[]};s.agents.set(parsed.agent,agent);}
    if(!agent.name&&parsed.agentName)agent.name=parsed.agentName;
    agent.requests.push(...parsed.requests);
  }
  return {sessions:[...sessions.values()],files:files.length,malformed,roots};
}
function zonedBoundary(year,month,dayOfMonth,hour,minute,zone){
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const target=Date.UTC(year,month,Math.min(dayOfMonth,last),hour,minute);
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let candidate=target;
  for(let i=0;i<4;i++){
    const parts=Object.fromEntries(fmt.formatToParts(candidate).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    const represented=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
    const diff=target-represented;
    candidate+=diff;
    if(!diff)break;
  }
  return candidate;
}
export function timeWindow(value,now=Date.now(),billingDay=null,billingTimeZone='UTC',billingHour=0,billingMinute=0) {
  if(!value||value==='all') return [-Infinity,Infinity];
  const d=new Date(now);const utcStart=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  if(value==='today')return [utcStart,utcStart+day];
  if(value==='yesterday')return [utcStart-day,utcStart];
  if(value==='7d')return [now-7*day,now];
  if(value==='30d')return [now-30*day,now];
  if(value==='month')return [Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1),Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)];
  if(value==='previous-month')return [Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1),Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)];
  if(value==='cycle'||value==='previous-cycle') {
    if(!Number.isInteger(billingDay)||billingDay<1||billingDay>31) throw new Error('Billing cycle requires --billing-day 1..31 (UTC-based approximation)');
    const zone=billingTimeZone||'UTC';
    const local=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'numeric'}).formatToParts(now);
    const parts=Object.fromEntries(local.filter(p=>p.type==='year'||p.type==='month').map(p=>[p.type,Number(p.value)]));
    let y=parts.year,m=parts.month-1;
    const boundary=(yy,mm)=>zonedBoundary(yy,mm,billingDay,billingHour,billingMinute,zone);
    let current=boundary(y,m);
    if(now<current){m--;current=boundary(y,m);}
    if(value==='cycle')return [current,boundary(y,m+1)];
    return [boundary(y,m-1),current];
  }
  const match=/^(\d{4}-\d\d-\d\d):(\d{4}-\d\d-\d\d)$/.exec(value);
  if(match){const a=Date.parse(match[1]+'T00:00:00Z'),b=Date.parse(match[2]+'T00:00:00Z');if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)throw new Error('Invalid date range');return [a,b+day];}
  throw new Error('Invalid --period. Use all,today,yesterday,7d,30d,month,previous-month,cycle,previous-cycle,YYYY-MM-DD:YYYY-MM-DD');
}
export function summarize(data,window=[-Infinity,Infinity],rates=DEFAULT_RATES) {
  const projects=new Map(), sessions=[];const models=new Map();const overall=ZERO();
  for(const s of data.sessions){
    const stat=ZERO(),agents=[];
    for(const a of s.agents.values()){
      const am=ZERO();const byModel=new Map();
      for(const r of a.requests){if(r.timestamp===null||r.timestamp<window[0]||r.timestamp>=window[1])continue;
        const one=ZERO();Object.assign(one,{input:r.input,output:r.output,cacheWrite:r.cacheWrite,cacheRead:r.cacheRead,requests:1});
        const cost=costFor(r.model,r,rates);if(cost===null)one.unknownCostRequests=1;else one.knownCost=cost;
        add(am,one);add(overall,one);
        if(!byModel.has(r.model))byModel.set(r.model,ZERO());add(byModel.get(r.model),one);
        if(!models.has(r.model))models.set(r.model,ZERO());add(models.get(r.model),one);
      }
      if(am.requests){add(stat,am);agents.push({id:a.id,name:a.name||null,stats:am,models:[...byModel].map(([name,stats])=>({name,stats}))});}
    }
    if(!stat.requests)continue;
    const project=s.cwd||'(unknown project)';
    if(!projects.has(project))projects.set(project,{name:project,stats:ZERO(),sessions:0,models:new Map()});
    const pr=projects.get(project);add(pr.stats,stat);pr.sessions++;
    for(const a of agents)for(const m of a.models){if(!pr.models.has(m.name))pr.models.set(m.name,ZERO());add(pr.models.get(m.name),m.stats);}
    const sm=new Map();for(const a of agents)for(const m of a.models){if(!sm.has(m.name))sm.set(m.name,ZERO());add(sm.get(m.name),m.stats);}
    sessions.push({id:s.id,title:s.title||s.id,project,start:s.start,end:s.end,stats:stat,agents,models:[...sm].map(([name,stats])=>({name,stats}))});
  }
  return {overall,projects:[...projects.values()].map(p=>({...p,models:[...p.models].map(([name,stats])=>({name,stats}))})),sessions,models:[...models].map(([name,stats])=>({name,stats})),files:data.files,malformed:data.malformed,roots:data.roots};
}
export function selectCurrentProject(report,cwd) {
  const normalized=p=>path.resolve(p).toLowerCase();
  const exact=report.projects.filter(p=>p.name!=='(unknown project)' && normalized(p.name)===normalized(cwd));
  return exact;
}
export function selectCurrentSession(report,sessionId) {
  if(!sessionId) return [];
  return report.sessions.filter(s=>s.id===sessionId);
}
function table(headers,rows){
  const widths=headers.map((h,i)=>Math.min(62,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))));
  const line=r=>'| '+r.map((v,i)=>String(v??'').slice(0,widths[i]).padEnd(widths[i])).join(' | ')+' |';
  console.log(line(headers));console.log('| '+widths.map(w=>'-'.repeat(w)).join(' | ')+' |');
  for(const r of rows)console.log(line(r));
  if(!rows.length)console.log('(no matching usage)');
}
function formatStats(s){return `${number(totalTokens(s))} tokens | ${number(s.input)} in / ${number(s.output)} out / ${number(s.cacheWrite)} cache-write / ${number(s.cacheRead)} cache-read | ${money(s.knownCost)} estimated${s.unknownCostRequests?' + unknown pricing ('+s.unknownCostRequests+')':''}`;}
function rank(items){return items.sort((a,b)=>b.stats.knownCost-a.stats.knownCost || totalTokens(b.stats)-totalTokens(a.stats));}
function show(title,items,limit=25){console.log('\n'+title);for(const [i,x] of rank(items).slice(0,limit).entries())console.log(`${String(i+1).padStart(2)}. ${x.name||x.title} — ${formatStats(x.stats)}`);if(!items.length)console.log('  No matching usage.');}
export async function main(argv){
  const command=argv[0]||'overview';const opts={};
  for(let i=1;i<argv.length;i++){const v=argv[i];if(v.startsWith('--')){const [key,inline]=v.slice(2).split('=',2);opts[key]=inline??(argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true);}}
  if(['help','--help','-h'].includes(command)){console.log(`Claude Usage Explorer v0.1.0\n\nCommands: overview | projects | sessions | models | high | diagnostics | current-project | current-session\nOptions: --root PATH --period all|today|yesterday|7d|30d|month|previous-month|cycle|previous-cycle|YYYY-MM-DD:YYYY-MM-DD\n         --billing-day 1..31 --limit N --json --rates PATH\n\nExamples:\n  claude-usage overview --period 7d\n  claude-usage sessions --period cycle --billing-day 15\n  claude-usage projects --json`);return;}
  if(!['overview','projects','sessions','models','high','diagnostics','current-project','current-session'].includes(command))throw new Error('Unknown command: '+command);
  let rates=DEFAULT_RATES;
  if(opts.rates){const custom=JSON.parse(fs.readFileSync(path.resolve(opts.rates),'utf8'));rates={...rates,...custom};}
  const roots=opts.root?[path.resolve(opts.root)]:projectRoots();
  const data=ingest(roots,rates),window=timeWindow(opts.period||'all',Date.now(),opts['billing-day']?Number(opts['billing-day']):null);
  const report=summarize(data,window,rates);const limit=Math.max(1,Math.min(500,Number(opts.limit)||25));
  if(command==='current-project') {
    const cwd=path.resolve(String(opts.cwd||process.cwd()));
    const selected=selectCurrentProject(report,cwd);
    if(opts.json){console.log(JSON.stringify({cwd,projects:selected,sessions:report.sessions.filter(s=>selected.some(p=>p.name===s.project))},null,2));return;}
    console.log('Current project: '+cwd);
    table(['Project','Tokens','Input','Output','Cache write','Cache read','Est. USD'],selected.map(p=>[path.basename(p.name),number(totalTokens(p.stats)),number(p.stats.input),number(p.stats.output),number(p.stats.cacheWrite),number(p.stats.cacheRead),money(p.stats.knownCost)]));
    if(!selected.length)console.log('No usage found for this exact project path. Use --cwd PATH if needed.');
    else table(['Session','Tokens','Est. USD'],rank(report.sessions.filter(s=>s.project===selected[0].name)).slice(0,limit).map(s=>[s.title,number(totalTokens(s.stats)),money(s.stats.knownCost)]));
    return;
  }
  if(command==='current-session') {
    const id=String(opts['session-id']||process.env.CLAUDE_SESSION_ID||'');
    if(!id) {console.log('Current session ID is unavailable. Supply --session-id UUID (do not guess from latest activity).');return;}
    const selected=selectCurrentSession(report,id);
    if(opts.json){console.log(JSON.stringify({sessionId:id,sessions:selected},null,2));return;}
    console.log('Current session: '+id);
    table(['Session','Tokens','Input','Output','Cache write','Cache read','Est. USD'],selected.map(s=>[s.title,number(totalTokens(s.stats)),number(s.stats.input),number(s.stats.output),number(s.stats.cacheWrite),number(s.stats.cacheRead),money(s.stats.knownCost)]));
    for(const s of selected){table(['Agent','Tokens','Est. USD'],s.agents.map(a=>[a.id,number(totalTokens(a.stats)),money(a.stats.knownCost)]));}
    return;
  }
  if(opts.json){console.log(JSON.stringify({...report,period:opts.period||'all'},null,2));return;}
  console.log('Claude Usage Explorer | '+(opts.period||'all')+' | estimated API-equivalent costs (USD)');
  if(command==='diagnostics'){console.log('Roots:',roots.join(', '));console.log('JSONL files:',data.files,'Malformed records/files:',data.malformed,'Sessions:',data.sessions.length);console.log('All source data is read-only. Unknown models have no price.');return;}
  if(command==='overview'){console.log('\nTotal: '+formatStats(report.overall));show('Top projects',report.projects,Math.min(10,limit));show('Top models',report.models,Math.min(10,limit));show('Top sessions',report.sessions,Math.min(10,limit));}
  if(command==='projects')table(['Project','Sessions','Tokens','Est. USD'],rank(report.projects).slice(0,limit).map(p=>[p.name,p.sessions,number(totalTokens(p.stats)),money(p.stats.knownCost)]));
  if(command==='sessions')table(['Session','Project','Tokens','Est. USD'],rank(report.sessions).slice(0,limit).map(s=>[s.title,path.basename(s.project),number(totalTokens(s.stats)),money(s.stats.knownCost)]));
  if(command==='models')table(['Model','Requests','Input','Output','Cache write','Cache read','Tokens','Est. USD'],rank(report.models).slice(0,limit).map(m=>[m.name,m.stats.requests,number(m.stats.input),number(m.stats.output),number(m.stats.cacheWrite),number(m.stats.cacheRead),number(totalTokens(m.stats)),money(m.stats.knownCost)]));
  if(command==='high'){
    const sorted=rank(report.sessions);show('Highest-consumption sessions',sorted,limit);
    console.log('\nNote: ranked by known estimated cost, then tokens; statistical percentile classification is planned.');
  }
  if(data.malformed)console.log(`\nWarning: ${data.malformed} malformed JSONL records or unreadable files skipped.`);
  if(report.overall.unknownCostRequests)console.log('Warning: some models lack pricing; cost rankings may be incomplete.');
}

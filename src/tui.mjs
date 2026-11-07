import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawnSync} from 'node:child_process';
import {readPlanUsage} from './plan-usage.mjs';
import {ingest,projectRoots,summarize,timeWindow,totalTokens,number,DEFAULT_RATES} from './core.mjs';

const periods=[['Current billing cycle','cycle'],['Previous billing cycle','previous-cycle'],['All time','all'],['Today','today'],['Yesterday','yesterday'],['Last 7 days','7d'],['Last 30 days','30d'],['This month','month'],['Previous month','previous-month'],['Custom dates','custom']];
export function describePeriod(period, settings={}, now=Date.now()){
 const base=periods.find(([,id])=>id===period)?.[0]||period;
 if(!['cycle','previous-cycle'].includes(period))return base;
 if(!Number.isInteger(settings.billingDay)||settings.billingDay<1||settings.billingDay>31)return base+' · Set renewal date';
 try{
  const [start,end]=timeWindow(period,now,settings.billingDay,settings.billingTimeZone||'UTC',settings.billingHour||0,settings.billingMinute||0);
  const format=new Intl.DateTimeFormat('en-US',{timeZone:settings.billingTimeZone||'UTC',month:'short',day:'numeric',year:'numeric'});
  return `${base} · ${format.format(start)} – ${format.format(end-1)}`;
 }catch{return base+' · Invalid billing settings';}
}
const fmt=n=>number(n||0);
const truncate=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,Math.max(0,n-1))+'…':s;};
const money=s=>s.unknownCostRequests?`${s.knownCost?'$'+s.knownCost.toFixed(2)+' + ':''}N/A`:`$${s.knownCost.toFixed(2)}`;
const settingFile=()=>path.join(os.homedir(),'.claude-usage-explorer','settings.json');
function readSettings(){try{return JSON.parse(fs.readFileSync(settingFile(),'utf8'));}catch{return {};}}
function saveSettings(s){fs.mkdirSync(path.dirname(settingFile()),{recursive:true,mode:0o700});fs.writeFileSync(settingFile(),JSON.stringify(s,null,2),{mode:0o600});}
const sortColumns=[['cost','Est. USD'],['tokens','Tokens'],['requests','Requests'],['input','Input'],['output','Output'],['cacheWrite','Cache write'],['cacheRead','Cache read'],['name','Name']];
const value=(r,key)=>key==='tokens'?totalTokens(r.stats):key==='cost'?r.stats.unknownCostRequests?null:r.stats.knownCost:key==='name'?r.label.toLowerCase():r.stats[key];
const empty={requests:0,input:0,output:0,cacheWrite:0,cacheRead:0,knownCost:0,unknownCostRequests:0};
export function createExplorer(data,{cwd=process.cwd(),settings=readSettings(),period=settings.lastPeriod||'all',planReader=readPlanUsage}={}){
 let planUsage=null,planCheckedAt=0;
 function refreshPlan(now=Date.now()){if(now-planCheckedAt<4000)return;planCheckedAt=now;try{planUsage=planReader({now})||null;}catch{planUsage=null;}}
 let liveState={enabled:true,lastUpdated:Date.now(),lastCheck:Date.now(),error:null};
 let sourceData=data,view='projects',selection=0,offset=0,stack=[],sort='tokens',descending=true,filter='',message='',currentPeriod=period,project=null,session=null,agent=null,report=null;
 const rates=()=>({...DEFAULT_RATES,...settings.rates});
 function refresh(){try{report=summarize(sourceData,timeWindow(currentPeriod,Date.now(),settings.billingDay,settings.billingTimeZone||'UTC',settings.billingHour||0,settings.billingMinute||0),rates());message=report.overall.unknownCostRequests?`${fmt(report.overall.unknownCostRequests)} requests have unknown model prices. Configure rates in Settings (B).`:'';}catch(e){message=e.message;currentPeriod='all';report=summarize(sourceData,undefined,rates());}}
 refresh();
 function rows(){let list=[];
  if(view==='projects')list=report.projects.map(x=>({...x,label:path.basename(x.name)||x.name}));
  if(view==='sessions')list=report.sessions.filter(x=>!project||x.project===project.name).map(x=>({...x,label:x.title}));
  if(view==='agents')list=(session?.agents||[]).map(x=>({...x,label:x.id==='main'?'Agent (main)':(x.name||x.type||'Subagent')}));
  if(view==='models')list=(agent?.models||session?.models||project?.models||report.models).map(x=>({...x,label:x.name}));
  if(view==='periods')list=periods.map(([,v])=>({label:describePeriod(v,settings),value:v,stats:empty}));
  if(view==='settings')list=[{label:`Billing: day ${settings.billingDay||'not set'} at ${String(settings.billingHour||0).padStart(2,'0')}:${String(settings.billingMinute||0).padStart(2,'0')} ${settings.billingTimeZone||'UTC'}`,value:'billing',stats:empty},{label:`Custom model prices: ${Object.keys(settings.rates||{}).length} configured`,value:'rates',stats:empty},{label:'Rescan history (R)',value:'rescan',stats:empty}];
  if(view==='sort')list=sortColumns.map(([value,label])=>({value,label,stats:empty}));
  if(filter&&!['periods','settings','sort'].includes(view))list=list.filter(x=>x.label.toLowerCase().includes(filter.toLowerCase()));
  if(!['periods','settings','sort'].includes(view))list.sort((a,b)=>{const av=value(a,sort),bv=value(b,sort);if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;let v=typeof av==='string'?av.localeCompare(bv):av-bv;return descending?-v:v;});
  return list;
 }
 function nav(next){stack.push({view,selection,offset,project,session,agent,filter});view=next;selection=0;offset=0;filter='';}
 function restore(){if(!stack.length){switchView('projects');return;}const p=stack.pop();view=p.view;selection=p.selection;offset=p.offset;project=p.project;session=p.session;agent=p.agent;filter=p.filter;}
 function switchView(next){view=next;selection=0;offset=0;stack=[];filter='';project=null;session=null;agent=null;}
 function open(){const x=rows()[selection];if(!x)return null;
  if(view==='projects'){project=x;nav('sessions');}
  else if(view==='sessions'){session=x;nav('agents');}
  else if(view==='agents'){agent=x;nav('models');}
  else if(view==='periods'){if(x.value==='custom')return 'custom';if(['cycle','previous-cycle'].includes(x.value)&&!(Number.isInteger(settings.billingDay)&&settings.billingDay>=1&&settings.billingDay<=31))return `billing-required:${x.value}`;currentPeriod=x.value;settings.lastPeriod=currentPeriod;saveSettings(settings);refresh();restore();}
  else if(view==='settings')return x.value;
  else if(view==='sort'){setSort(x.value);restore();}
  else if(view==='models')message=`${x.name} · ${fmt(totalTokens(x.stats))} tokens · ${money(x.stats)} estimated USD`;
  return null;
 }
 function rescan(roots,{automatic=false}={}){
  const selectedProject=project?.name,selectedSession=session?.id,selectedAgent=agent?.id;
  const selectedRow=rows()[selection];const selectedId=selectedRow?.id??selectedRow?.name??selectedRow?.value;
  sourceData=ingest(roots);refresh();
  project=report.projects.find(p=>p.name===selectedProject)||null;
  session=report.sessions.find(s=>s.id===selectedSession&&(!project||s.project===project.name))||null;
  agent=session?.agents.find(a=>a.id===selectedAgent)||null;
  if(view==='sessions'&&!project)view='projects';
  if(view==='agents'&&!session)view=project?'sessions':'projects';
  if(view==='models'&&!agent&&!session&&!project){/* all-model scope is valid */}
  const updatedRows=rows();const index=updatedRows.findIndex(r=>(r.id??r.name??r.value)===selectedId);
  selection=index>=0?index:Math.min(selection,Math.max(0,updatedRows.length-1));
  liveState.lastUpdated=Date.now();liveState.error=null;
  if(!automatic)message='History refreshed.';
 }
 function setLiveState(update){liveState={...liveState,...update};}
 function toggleLive(){liveState.enabled=!liveState.enabled;liveState.lastCheck=Date.now();}
 function setPeriod(p){currentPeriod=p;settings.lastPeriod=p;saveSettings(settings);refresh();switchView('projects');}
 function setBillingDay(n,timeZone='UTC',hour=0,minute=0){settings.billingDay=n;settings.billingTimeZone=timeZone;settings.billingHour=hour;settings.billingMinute=minute;saveSettings(settings);refresh();message=`Billing saved: day ${n}, ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} ${timeZone}.`;}
 function setModelRate(model,values){settings.rates??={};settings.rates[model]=values;saveSettings(settings);refresh();message=`Saved custom USD/million-token rates for ${model}.`;}
 function setFilter(s){filter=s;selection=0;offset=0;}
 function setSort(key){if(sort===key)descending=!descending;else{sort=key;descending=key!=='name';}selection=0;offset=0;}
 function render(width=process.stdout.columns||110,height=process.stdout.rows||30){
  refreshPlan();
  width=Math.max(20,width);height=Math.max(8,height);
  const tty=process.stdout.isTTY && !process.env.NO_COLOR;
  const c=(text,style)=>tty?`\x1b[${style}m${text}\x1b[0m`:text;
  const line=(str='')=>out.push(clipAnsi(str,Math.max(1,width-1)));
  const rule=()=>line(c('─'.repeat(width),'90'));
  const out=[];
  const pad=(str,n,align='left')=>{str=truncate(str,n);return align==='right'?str.padStart(n):str.padEnd(n);};
  const title=['PROJECTS','SESSIONS','AGENTS','MODELS','DATES','SETTINGS','SORT'][['projects','sessions','agents','models','periods','settings','sort'].indexOf(view)]||view.toUpperCase();
  line(c('  ◈ CLAUDE USAGE EXPLORER','1;36')+c(`     ${title}     LOCAL • NO AI CALLS`,'90'));
  rule();
  const crumb=['Projects',project&&path.basename(project.name),session&&truncate(session.title,32),agent&&agent.label].filter(Boolean).join('  ›  ');
  line(`  ${c(crumb,'1')}     ${c('PERIOD','90')} ${describePeriod(currentPeriod,settings)}     ${c('SORT','90')} ${sort} ${descending?'↓':'↑'}`);
  const scoped=view==='sessions'?project?.stats:view==='agents'?session?.stats:view==='models'?(agent?.stats||session?.stats||project?.stats||report.overall):report.overall;
  line(`  ${c('TOTAL','90')} ${fmt(totalTokens(scoped))} tokens     ${fmt(scoped.requests)} requests     ${c(money(scoped),'1;32')} API-equivalent`);
  const planLabel=planUsage?`5h ${planUsage.fiveHour??'—'}% · 7d ${planUsage.sevenDay??'—'}% · ${planUsage.stale?'Cached, may be outdated':'Cached, recent'}`:'Claude Desktop plan usage unavailable';
  line(`  ${c('PLAN LIMITS','1;36')}  ${c(planLabel,'90')}`);
  rule();
  const available=rows();selection=Math.max(0,Math.min(selection,Math.max(0,available.length-1)));
  const selected=available[selection];
  const breakdown=view==='models'?null:selected?.models|| (view==='projects'?report.models:view==='sessions'?project?.models:view==='agents'?session?.models:agent?.models);
  // Fixed-height table, model panel, and footer prevent vertical jumping on selection.
  const modelPanelHeight=7; // heading + five model rows + divider
  const footerHeight=5; // separator, two shortcuts, search, status
  const headerHeight=7;
  const visible=Math.max(0,height-headerHeight-modelPanelHeight-footerHeight-2);
  if(selection<offset)offset=selection;if(selection>=offset+visible)offset=selection-visible+1;
  // Keep columns aligned by terminal width, shrinking the name first.
  const columns=width>=135?[['REQ',7,'requests'],['INPUT',10,'input'],['OUTPUT',10,'output'],['C.WRITE',12,'cacheWrite'],['C.READ',13,'cacheRead'],['TOKENS',14,'tokens'],['USD',13,'cost']]:width>=105?[['REQ',7,'requests'],['OUTPUT',11,'output'],['C.WRITE',13,'cacheWrite'],['C.READ',14,'cacheRead'],['TOKENS',15,'tokens'],['USD',12,'cost']]:[['REQ',7,'requests'],['TOKENS',15,'tokens'],['USD',13,'cost']];
  const rightMargin=4; // Always leave a few columns clear of the terminal's right edge.
  const labelWidth=Math.max(17,width-5-rightMargin-7-columns.reduce((sum,[,n])=>sum+n+1,0));
  if(!['periods','settings','sort'].includes(view)){
    line(c('  '+pad('NAME',labelWidth)+' '+pad('SHARE',6,'right')+' '+columns.map(([name,n,key])=>pad(name+(sort===key?(descending?'↓':'↑'):''),n,'right')).join(' '),'1;36'));
  }
  for(let i=offset;i<Math.min(available.length,offset+visible);i++){
    const x=available[i],active=i===selection;
    let text;
    if(['periods','settings','sort'].includes(view))text=`  ${active?'❯':' '} ${x.label}${view==='periods'&&x.value===currentPeriod?'   ✓':''}`;
    else {const s=x.stats;const vals={requests:fmt(s.requests),input:fmt(s.input),output:fmt(s.output),cacheWrite:fmt(s.cacheWrite),cacheRead:fmt(s.cacheRead),tokens:fmt(totalTokens(s)),cost:money(s)};
      const parentTotal=view==='projects'?totalTokens(report.overall):view==='sessions'?totalTokens(project?.stats):view==='agents'?totalTokens(session?.stats):totalTokens(agent?.stats||report.overall);
      const pct=parentTotal>0?(totalTokens(s)>0&&100*totalTokens(s)/parentTotal<0.05?'<0.1%':(100*totalTokens(s)/parentTotal).toFixed(1)+'%'):'—';
      text=`  ${active?'❯':' '} ${pad(x.label,labelWidth)} ${pad(pct,6,'right')} `+columns.map(([,n,key])=>pad(vals[key],n,'right')).join(' ');
    }
    line(active?c(truncate(text,width),'7'):truncate(text,width));
  }
  if(!available.length)line(c('  No matching records. Press / to clear your search.','33'));
  // Fill the table viewport so the model panel and help never move.
  const renderedRows=Math.min(available.length-offset,visible);
  for(let i=renderedRows;i<visible;i++)line('');
  line(c(`  ${available.length?`${offset+1}–${Math.min(available.length,offset+visible)} of ${available.length}`:'0 rows'}   •   PgUp/PgDn scroll`,'90'));
  rule();
  line(c('  MODELS IN SELECTED ROW','1;36')+c('    (M: full model table)','90'));
  const models=breakdown?[...breakdown].sort((a,b)=>totalTokens(b.stats)-totalTokens(a.stats)).slice(0,5):[];
  for(let i=0;i<5;i++){
    const m=models[i];
    line(m?`  ${pad(m.name,30)} ${pad(fmt(totalTokens(m.stats)),16,'right')} tokens   ${pad(money(m.stats),14,'right')}`:'');
  }
  rule();
  line(c('  ↑↓ Navigate   ENTER Open   BACKSPACE Back   M Models   D Dates   O Sort   / Search','1'));
  line(c('  B Settings   S Reverse sort   C Current project   E Open session   ? Help   Q Quit','90'));
  line(c('  '+(filter?'Search: '+truncate(filter,width-12):' '),'36'));
  line(c(`  ${liveState.enabled?'● LIVE':'Ⅱ PAUSED'} · Updated ${Math.max(0,Math.floor((Date.now()-liveState.lastUpdated)/1000))}s ago${liveState.error?' · '+liveState.error:''}`,'36')+(message?'  '+c(truncate(message,Math.max(10,width-65)),'33'):''));
  return out.slice(0,Math.max(1,height-1)).join('\n');
 }
 return {render,refreshPlan,get planUsage(){return planUsage;},rows,open,restore,switchView,nav,refresh,rescan,setLiveState,toggleLive,get liveState(){return liveState;},setPeriod,setBillingDay,setModelRate,setFilter,setSort,get view(){return view;},get currentPeriod(){return currentPeriod;},get settings(){return settings;},get cwd(){return cwd;},get selection(){return selection;},set selection(v){selection=v;},get sort(){return sort;},set sort(v){setSort(v);},get project(){return project;},set project(v){project=v;},get session(){return session;},get report(){return report;},get message(){return message;},set message(v){message=v;}};
}
// Clip colored output to the terminal viewport to prevent line wrapping and scroll flashes.
export function clipAnsi(value, maxWidth) {
 const tokens=String(value).match(/\x1b\[[0-9;]*m|[^\x1b]+/g)||[];
 let output='', count=0, styled=false;
 for(const token of tokens){
  if(token.startsWith('\x1b[')){output+=token;styled=token!=='\x1b[0m';continue;}
  for(const char of token){
   const size=char.codePointAt(0)>0xffff?2:1;
   if(count+size>maxWidth){if(styled)output+='\x1b[0m';return output;}
   output+=char;count+=size;
  }
 }
 return output;
}
// Update only changed terminal rows. Never clear the entire screen for navigation.
export function screenDiff(previous, next, {force=false}={}) {
 const old=previous===null?[]:previous.split('\n');
 const current=next.split('\n');
 let output='';
 for(let i=0;i<Math.max(old.length,current.length);i++){
  if(!force && old[i]===current[i])continue;
  output+=`\x1b[${i+1};1H\x1b[2K${current[i]??''}`;
 }
 return output;
}
export async function launchTui(argv=[]){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Requires an interactive terminal (TTY). Run claude-usage tui in a terminal.');
 const i=argv.indexOf('--root');const roots=i>=0&&argv[i+1]?[path.resolve(argv[i+1])]:projectRoots();const ci=argv.indexOf('--cwd');const cwd=ci>=0&&argv[ci+1]?path.resolve(argv[ci+1]):process.cwd();const explorer=createExplorer(ingest(roots),{cwd});
 readline.emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\x1b[?1049h\x1b[?25l');
 let previousFrame=null;
 const draw=()=>{const frame=explorer.render();const changes=screenDiff(previousFrame,frame);if(changes)process.stdout.write(changes);previousFrame=frame;};
 let lastDimensions='';
 const resize=()=>{const dimensions=`${process.stdout.columns}x${process.stdout.rows}`;if(dimensions===lastDimensions)return;lastDimensions=dimensions;previousFrame=null;process.stdout.write('\x1b[H\x1b[J');draw();};
 const close=()=>{clearInterval(liveTimer);process.stdin.off('keypress',onKey);process.stdout.off('resize',resize);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\x1b[?25h\x1b[?1049l');};
 let prompting=false,checking=false;
 // Cheap metadata scans; only reparse transcripts when their size/mtime changes.
 let lastSignature=historySignature(roots);
 const liveTimer=setInterval(()=>{
  if(!explorer.liveState.enabled||prompting||checking)return;
  checking=true;
  try{
   const next=historySignature(roots);
   if(next!==lastSignature){explorer.rescan(roots,{automatic:true});lastSignature=next;draw();}
   explorer.setLiveState({lastCheck:Date.now()});
  }catch(e){explorer.setLiveState({error:e.message});draw();}
  finally{checking=false;}
 },5000);
 liveTimer.unref();
 async function ask(q){prompting=true;process.stdin.setRawMode(false);previousFrame=null;process.stdout.write('\x1b[?25h\x1b[H\x1b[2J'+q+'\n> ');const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});return new Promise(resolve=>rl.question('',a=>{rl.close();process.stdin.resume();process.stdin.setRawMode(true);prompting=false;process.stdout.write('\x1b[?25l');resolve(a);}));}
 async function onKey(str,key={}){
  if(prompting)return;if((key.ctrl&&key.name==='c')||str==='q'){close();return;}
  const len=explorer.rows().length;
  if(key.name==='up'||str==='k')explorer.selection=Math.max(0,explorer.selection-1);
  else if(key.name==='down'||str==='j')explorer.selection=Math.min(len-1,explorer.selection+1);
  else if(key.name==='pageup')explorer.selection=Math.max(0,explorer.selection-10);
  else if(key.name==='pagedown')explorer.selection=Math.min(len-1,explorer.selection+10);
  else if(key.name==='return'){
   const action=explorer.open();
   if(action==='custom'){const s=(await ask('Custom inclusive dates YYYY-MM-DD:YYYY-MM-DD (Enter to cancel):')).trim();if(s){try{timeWindow(s);explorer.setPeriod(s);}catch(e){explorer.message=e.message;}}}
   if(action==='rescan')explorer.rescan(roots);
   if(action==='billing'||action?.startsWith('billing-required:')){
    const n=Number(await ask('Billing renewal day of month (1–31):'));
    const zone=(await ask('IANA timezone (e.g. Europe/Athens, Europe/Amsterdam, UTC):')).trim()||'UTC';
    const time=(await ask('Renewal time HH:MM (24h, default 00:00):')).trim()||'00:00';
    const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    let validZone=true;try{new Intl.DateTimeFormat('en-US',{timeZone:zone});}catch{validZone=false;}
    if(Number.isInteger(n)&&n>=1&&n<=31&&match&&validZone){explorer.setBillingDay(n,zone,Number(match[1]),Number(match[2]));if(action?.startsWith('billing-required:'))explorer.setPeriod(action.split(':')[1]);}
    else explorer.message='Invalid billing day, timezone, or time; nothing saved.';
   }
   if(action==='rates'){
    const model=await ask('Exact model ID (e.g. claude-sonnet-5-5):');
    const raw=await ask('Verified USD per 1M tokens: input,output,cache-write,cache-read (comma separated):');
    const nums=raw.split(',').map(x=>Number(x.trim()));
    if(model.trim()&&nums.length===4&&nums.every(n=>Number.isFinite(n)&&n>=0))explorer.setModelRate(model.trim(),nums);else explorer.message='Invalid rates; no changes saved.';
   }
  }
  else if(key.name==='backspace'||key.name==='escape')explorer.restore();
  else if(str==='1')explorer.switchView('projects');
  else if(str==='2')explorer.switchView('sessions');
  else if(str==='3')explorer.switchView('models');
  else if(str==='m'){explorer.nav('models');}
  else if(str==='d')explorer.nav('periods');
  else if(str==='b')explorer.nav('settings');
  else if(str==='o')explorer.nav('sort');
  else if(str==='s')explorer.setSort(explorer.sort);
  else if(str==='C'){
   const selected=explorer.view==='sessions'?explorer.rows()[explorer.selection]:explorer.session;
   if(selected?.id&&process.platform==='darwin'){
    const result=spawnSync('pbcopy',[],{input:selected.id,encoding:'utf8'});
    explorer.message=result.status===0?'Session ID copied.':'Unable to copy session ID.';
   }else explorer.message='Select a session on macOS to copy its ID.';
  }
  else if(str==='e'){
   const selected=explorer.view==='sessions'?explorer.rows()[explorer.selection]:explorer.session;
   const directory=selected?.project||explorer.project?.name;
   if(!selected?.id||!directory||process.platform!=='darwin')explorer.message='External resume requires a selected session on macOS.';
   else if(!fs.existsSync(directory))explorer.message='Original project directory is missing.';
   else {
    const quote=x=>"'"+String(x).replaceAll("'","'\\''")+"'";
    const command=`cd ${quote(directory)} && claude --resume ${quote(selected.id)}`;
    const script=`tell application "Terminal" to do script ${JSON.stringify(command)}`;
    const result=spawnSync('osascript',['-e',script],{encoding:'utf8',timeout:10000});
    explorer.message=result.status===0?'Opened in Terminal.app.':`Unable to open Terminal: ${(result.stderr||'').slice(0,80)}`;
   }
  }
  else if(str==='c'){explorer.switchView('projects');const i=explorer.rows().findIndex(x=>path.resolve(x.name).toLowerCase()===path.resolve(explorer.cwd).toLowerCase());if(i>=0){explorer.selection=i;explorer.open();}else explorer.message='No exact match for current directory.';}
  else if(str==='/')explorer.setFilter(await ask('Filter table (empty clears):'));
  else if(str==='r'){explorer.rescan(roots);lastSignature=historySignature(roots);}
  else if(str==='l')explorer.toggleLive();
  else if(str==='?'){await ask('HELP\n↑↓ select rows; Enter drills down; Backspace goes back.\nM shows models at the current level.\nD selects date range; B configures billing and model prices.\nO chooses a sort column; S reverses direction.\n/ filters; C copies session ID; E opens selected session externally; R rescans; L toggles live updates; Q quits.\n\nPress Enter to return.');}
  draw();
 }
 process.stdin.on('keypress',onKey);process.stdout.on('resize',resize);resize();
}

// Scan only metadata on a 5-second interval. The ingestion cache handles unchanged JSONL.
export function historySignature(roots){
 const entries=[];
 for(const root of roots){
  const pending=[root];
  while(pending.length){
   const dir=pending.pop();let children;
   try{children=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
   for(const child of children){
    const file=path.join(dir,child.name);
    if(child.isDirectory())pending.push(file);
    else if(child.isFile()&&child.name.endsWith('.jsonl')){
     try{const stat=fs.statSync(file);entries.push(`${file}:${stat.size}:${stat.mtimeMs}`);}catch{}
    }
   }
  }
 }
 entries.sort();return entries.join('\n');
}

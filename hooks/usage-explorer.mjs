// Claude Code native mod. The UI uses host components; local analytics run in a child Node process.
// No model requests are made when opening, navigating or refreshing this pane.
// Native hooks run in a restricted loader; use web-standard URL APIs instead of node: imports.
export function scriptPathFromModuleUrl(moduleUrl){
  const url=new URL('../bin/claude-usage.mjs',moduleUrl);
  let p=decodeURIComponent(url.pathname);
  if(/^\/[A-Za-z]:\//.test(p))p=p.slice(1);
  if(url.host&&url.host!=='localhost')p=`//${url.host}${p}`;
  return p;
}
const PANE='claude-usage-explorer';
const PERIODS=[['Billing cycle','cycle'],['Previous cycle','previous-cycle'],['All time','all'],['Today','today'],['Yesterday','yesterday'],['7 days','7d'],['30 days','30d'],['This month','month'],['Previous month','previous-month']];
let state={period:'all',view:'projects',stack:[],project:null,session:null,agent:null,report:null,periodLabel:'All time',loading:false,error:'',updatedAt:0,sort:'tokens',query:'',periodMenu:false};
let limitState={status:'not checked',source:'',rateLimits:[],details:[],checkedAt:0};
let limitInFlight=null;
let usageFieldSchema=[];

let officialSpend=null;
let sessionActionStatus='';
let focusedSessionId=null;
const LIMIT_REFRESH_MS=180000;
let timer=null;
let inFlight=null;
const total=s=>(s?.input||0)+(s?.output||0)+(s?.cacheRead||0)+(s?.cacheWrite||0);
const compact=n=>Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n||0);
const share=(part,whole)=>whole>0?(part>0&&100*part/whole<0.05?'<0.1%':`${(100*part/whole).toFixed(1)}%`):'—';
const price=s=>s?.unknownCostRequests?'N/A':`$${(s?.knownCost||0).toFixed(2)}`;
const name=p=>String(p||'').replace(/\\/g,'/').split('/').filter(Boolean).pop()||p;
export const agentLabel=a=>a?.id==='main'?'Agent (main)':(a?.name||a?.type||'Subagent');
const change=($,patch)=>{state={...state,...patch};void $.ui.invalidate('ui.render');};
export function itemsFor(s=state){
  const r=s.report;
  if(!r)return [];
  let items=[];
  if(s.view==='projects')items=r.projects.map(x=>({id:x.name,label:name(x.name),stats:x.stats,source:x}));
  if(s.view==='sessions')items=r.sessions.filter(x=>!s.project||x.project===s.project).map(x=>({id:x.id,label:x.title,stats:x.stats,source:x}));
  if(s.view==='agents'){const current=r.sessions.find(x=>x.id===s.session?.id)||s.session;items=(current?.agents||[]).map(x=>({id:x.id,label:agentLabel(x),stats:x.stats,source:x}));}
  if(s.view==='models'){const current=r.sessions.find(x=>x.id===s.session?.id)||s.session;items=modelScope(s).map(x=>({id:x.name,label:x.name,stats:x.stats,source:x}));}
  if(s.query)items=items.filter(x=>x.label.toLowerCase().includes(s.query.toLowerCase()));
  return items.sort((a,b)=>s.sort==='cost'?(b.stats.knownCost-a.stats.knownCost):total(b.stats)-total(a.stats));
}
export function drill(s,item){
  const previous={view:s.view,project:s.project,session:s.session,agent:s.agent};
  if(s.view==='projects')return {...s,stack:[...s.stack,previous],view:'sessions',project:item.id,session:null,agent:null,query:''};
  if(s.view==='sessions')return {...s,stack:[...s.stack,previous],view:'agents',session:item.source,agent:null,query:''};
  if(s.view==='agents')return {...s,stack:[...s.stack,previous],view:'models',agent:item.source,query:''};
  return s;
}
export function modelScope(s){
  const r=s.report;
  if(!r)return [];
  const session=r.sessions.find(x=>x.id===s.session?.id)||s.session;
  const agent=session?.agents?.find(x=>x.id===s.agent?.id)||s.agent;
  const project=r.projects.find(x=>x.name===s.project);
  return agent?.models||session?.models||project?.models||r.models||[];
}
export function back(s){
  if(!s.stack.length)return {...s,view:'projects',project:null,session:null,agent:null,query:''};
  const last=s.stack[s.stack.length-1];
  return {...s,...last,stack:s.stack.slice(0,-1),query:''};
}
async function persistPeriod($,period){
  try {const script=scriptPathFromModuleUrl(import.meta.url);await $.process.run(['node',script,'preference','period',period],{timeoutMs:5000});}catch{}
}
async function refresh($){
  if(inFlight)return inFlight;
  change($,{loading:true,error:''});
  inFlight=(async()=>{
    try {
      // Module location resolves to the plugin's installed directory, independent of cwd.
      const script=scriptPathFromModuleUrl(import.meta.url);
      const result=await $.process.run(['node',script,'snapshot','--period',state.period],{timeoutMs:30000});
      if(result.exitCode!==0)throw new Error((result.stderr||'Unable to read usage').trim().slice(0,240));
      const snap=JSON.parse(result.stdout);
      if(!state.preferencesLoaded){state.period=snap.savedPeriod||state.period;state.preferencesLoaded=true;if(state.period!==snap.period){inFlight=null;return refresh($);}}
      // Refresh preserves the active drilldown; a missing session is handled by an empty list.
      change($,{report:snap.report,periodLabel:snap.periodLabel,updatedAt:snap.updatedAt,loading:false,error:''});
    }catch(err){change($,{loading:false,error:String(err?.message||err).slice(0,260)});}
  })().finally(()=>{inFlight=null});
  return inFlight;
}
// Opt-in diagnostic: never store or display the raw response, credentials or identifiers.
// The first-party OAuth usage route is undocumented; a failure is not fatal.
export function summarizeLimits(payload){
  if(!payload||typeof payload!=='object')return [];
  const lines=[];
  for(const [key,val] of Object.entries(payload)){
    if(!/^(five_hour|seven_day|seven_day_[a-z_]+|extra_usage|monthly|billing|usage|rate_limits)$/i.test(key))continue;
    if(val&&typeof val==='object'&&!Array.isArray(val)){
      const fields=[];
      for(const field of ['utilization','percentUsed','limit','used','remaining','resets_at','resetsAt','is_enabled']){
        const v=val[field];
        if(typeof v==='number'&&Number.isFinite(v))fields.push(`${field}: ${v}`);
        else if(typeof v==='boolean')fields.push(`${field}: ${v}`);
        else if((field==='resets_at'||field==='resetsAt')&&typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v))fields.push(`${field}: ${v.slice(0,25)}`);
      }
      if(fields.length)lines.push(`${key}: ${fields.join(' · ')}`);
    }
  }
  return lines.slice(0,12);
}
// Diagnostic exposes only structural metadata, never values, identifiers or credentials.
export function usageSchema(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return [];
  const rows=[];
  const walk=(obj,prefix,depth)=>{
    for(const [key,value] of Object.entries(obj)){
      if(rows.length>=90)return;
      // Only keys with conventional field-name syntax; avoid leaking arbitrary map keys.
      if(!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key))continue;
      const path=prefix?`${prefix}.${key}`:key;
      const type=value===null?'null':Array.isArray(value)?'array':typeof value;
      rows.push(`${path}: ${type}`);
      if(depth<2&&type==='object')walk(value,path,depth+1);
    }
  };
  walk(payload,'',0);
  return rows;
}
// Normalize money using currency minor units. Never add spend and extra_usage together.
export function parseOfficialSpend(payload){
  const spend=payload?.spend;
  const money=(obj)=>{
    if(!obj||!Number.isFinite(obj.amount_minor)||!Number.isInteger(obj.exponent)||obj.exponent<0||obj.exponent>8||typeof obj.currency!=='string')return null;
    return {amount:obj.amount_minor/10**obj.exponent,currency:obj.currency.toUpperCase()};
  };
  const used=money(spend?.used),limit=money(spend?.limit);
  if(used&&limit&&used.currency===limit.currency&&limit.amount>0){
    return {used:used.amount,limit:limit.amount,currency:used.currency,percent:Number.isFinite(spend?.percent)?spend.percent:100*used.amount/limit.amount,source:'spend'};
  }
  const extra=payload?.extra_usage;
  if(extra&&Number.isFinite(extra.used_credits)&&Number.isFinite(extra.monthly_limit)&&extra.monthly_limit>0&&typeof extra.currency==='string'){
    return {used:extra.used_credits,limit:extra.monthly_limit,currency:extra.currency.toUpperCase(),percent:Number.isFinite(extra.utilization)?extra.utilization:100*extra.used_credits/extra.monthly_limit,source:'extra_usage'};
  }
  return null;
}
const currencyAmount=(amount,currency)=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount);}catch{return `${amount.toFixed(2)} ${currency}`;}};
async function checkLimits($,{force=false}={}){
  if(limitInFlight)return limitInFlight;
  if(!force&&limitState.checkedAt&&Date.now()-limitState.checkedAt<LIMIT_REFRESH_MS)return;
  limitState={...limitState,status:'checking'};void $.ui.invalidate('ui.render');
  limitInFlight=(async()=>{try{
    const usage=await $.session.usage();
    const rateLimits=Array.isArray(usage?.rateLimits)?usage.rateLimits:[];
    limitState={status:rateLimits.length?'available':'no rate limits returned',source:'session.usage',rateLimits:rateLimits.map(x=>({kind:String(x.kind||'limit').slice(0,40),percentUsed:Number(x.percentUsed)||0,resetsAt:typeof x.resetsAt==='string'?x.resetsAt.slice(0,25):''})),details:[]};
    const authorization=await $.session.authorize();
    if(!authorization?.handle){limitState.status='No first-party authorization handle';return;}
    const response=await $.http.fetch('https://api.anthropic.com/api/oauth/usage',{auth:authorization.handle});
    if(!response.ok){limitState.status=`HTTP ${response.status}`;return;}
    const payload=JSON.parse(response.text);
    officialSpend=parseOfficialSpend(payload);
    const details=summarizeLimits(payload);
    limitState={...limitState,status:details.length?'available':'No recognized fields (Enterprise may differ)',source:'Claude session + OAuth usage',details};
  }catch(err){limitState={...limitState,status:`Unavailable: ${String(err?.message||err).slice(0,100)}`};}
  finally{limitState.checkedAt=Date.now();void $.ui.invalidate('ui.render');}
  })().finally(()=>{limitInFlight=null});
  return limitInFlight;
}
export function usageBar(percent,width=24){
  const value=Math.max(0,Math.min(100,Number.isFinite(percent)?percent:0));
  const count=Math.round(value/100*width);
  return `${'█'.repeat(count)}${'░'.repeat(width-count)}  ${value.toFixed(1)}%`;
}
export function officialLimitRows(limits){
  const rows=[];
  for(const limit of limits.rateLimits||[]){
    if(Number.isFinite(limit.percentUsed))rows.push({label:limit.kind,percent:limit.percentUsed,resetsAt:limit.resetsAt||''});
  }
  for(const line of limits.details||[]){
    const match=/^([^:]+):.*?utilization: ([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if(match){
      const resets=/resets_(?:at|At): ([^·]+)/.exec(line);
      rows.push({label:match[1],percent:Number(match[2]),resetsAt:resets?.[1]?.trim()||''});
    }
  }
  return rows;
}
// Session resume opens a separate terminal; no supported in-place Mods session switch is assumed.
export function sessionResumeCommand(session){
  if(!session?.id||!/^[a-f0-9-]{36}$/i.test(session.id))throw new Error('Invalid session ID');
  if(!session.project||typeof session.project!=='string'||!session.project.startsWith('/'))throw new Error('Original project directory unavailable');
  const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
  return `cd ${quote(session.project)} && claude --resume ${quote(session.id)}`;
}
export function selectedSessionForAction(s,focusedId){
  if(s.view==='sessions')return s.report?.sessions?.find(x=>x.id===focusedId&&(!s.project||x.project===s.project))||null;
  return s.report?.sessions?.find(x=>x.id===s.session?.id)||s.session||null;
}
async function sessionAction($,mode){
  const selected=selectedSessionForAction(state,focusedSessionId);
  try{
    if(!selected)throw new Error('Select a session first');
    if(mode==='copy'){
      const result=await $.process.run(['osascript','-e',`set the clipboard to ${JSON.stringify(selected.id)}`],{timeoutMs:5000});
      if(result.exitCode!==0)throw new Error('Clipboard unavailable');
      sessionActionStatus='Session ID copied';
    }else{
      const command=sessionResumeCommand(selected);
      // osascript argument is encoded as an AppleScript string, never shell-interpolated.
      const script=`tell application "Terminal" to do script ${JSON.stringify(command)}`;
      const result=await $.process.run(['osascript','-e',script],{timeoutMs:10000});
      if(result.exitCode!==0)throw new Error((result.stderr||'Unable to open Terminal').slice(0,120));
      sessionActionStatus='Opened session in Terminal.app';
    }
  }catch(error){sessionActionStatus=String(error?.message||error).slice(0,140);}
  void $.ui.invalidate('ui.render');
}
async function show($){await $.ui.open({id:PANE,title:'Claude Usage Explorer',focus:true,closeOnEscape:true});void refresh($);void checkLimits($);}
export function register(on){
  on('session.start',async ($,e,next)=>{
    await $.command.register({name:'usage-explorer',description:'Open the native interactive Claude Usage Explorer sidebar',immediate:true});
    return next(e);
  });
  on('command.run',{command:'usage-explorer'},async ($,e)=>{
    const surfaces=await $.session.surfaces().catch(()=>[]);
    if(surfaces.includes('terminal')&&!e.presentation.isFullscreen)return {text:'Use /tui fullscreen, then /usage-explorer. The native sidebar needs fullscreen layout.'};
    if(surfaces.includes('terminal')&&e.presentation.columns<100)return {text:'Widen the terminal to at least 100 columns, then /usage-explorer.'};
    await show($);
    timer?.cancel();timer=$.clock.every(5000,()=>{void refresh($);void checkLimits($);});
    return {text:'Usage Explorer opened in the sidebar. Navigation and refresh do not call the model.'};
  });
  on('ui.close',async ($,e,next)=>{if(e.id===PANE){timer?.cancel();timer=null;}return next(e);});
  on('session.end',async ($,e,next)=>{timer?.cancel();timer=null;return next(e);});
  on('ui.render',{component:'Pane',requestId:PANE},($,e,next)=>{
    if(e.surface!=='terminal'&&e.surface!=='desktop')return next(e);
    const {Box,Text,Button,Input}=$.ui.resolve(e);
    const rows=itemsFor();
    const press=item=>{sessionActionStatus='';if(state.view==='sessions')focusedSessionId=item.id;change($,drill(state,item));};
    const models=()=>{if(state.view==='models'){change($,back(state));return;}change($,{...state,stack:[...state.stack,{view:state.view,project:state.project,session:state.session,agent:state.agent}],view:'models',query:''});};
    const periodButtons=PERIODS.map(([label,id])=>Button({key:`period-${id}`,plain:true,label:id===state.period?`● ${label}`:`  ${label}`,onPress:()=>{change($,{period:id,periodMenu:false});void persistPeriod($,id);void refresh($);}}));
    const action=(label,hotkey,fn)=>Button({key:`action-${label}`,plain:true,label,hotkey,onPress:fn});
    const path=[state.project&&name(state.project),state.session?.title,state.agent?agentLabel(state.agent):null].filter(Boolean);
    const breadcrumb=`${state.view.toUpperCase()}${path.length?'  /  '+path.join(' / '):''}`;
    const stats=state.view==='projects'?state.report?.overall:state.view==='sessions'?state.report?.projects?.find(x=>x.name===state.project)?.stats:state.view==='agents'?state.session?.stats:state.view==='models'?(state.agent?.stats||state.session?.stats||state.report?.projects?.find(x=>x.name===state.project)?.stats||state.report?.overall):state.report?.overall;
    const scopeTotal=state.view==='projects'?total(stats):state.view==='sessions'?total(state.report?.projects?.find(x=>x.name===state.project)?.stats):state.view==='agents'?total(state.session?.stats):state.view==='models'?total(state.agent?.stats||state.session?.stats||state.report?.projects?.find(x=>x.name===state.project)?.stats||stats):total(stats);
    const scopeModels=modelScope(state).slice().sort((a,b)=>total(b.stats)-total(a.stats));
    const showModelSummary=state.view!=='models'&&scopeModels.length>0;
    const modelSummary=showModelSummary?Box({flexDirection:'column',children:[
      Text({bold:true,children:'MODEL USAGE'}),
      ...scopeModels.slice(0,4).map((model,i)=>Text({key:`model-summary-${i}`,dimColor:true,wrap:'truncate-end',children:`${model.name}  ·  ${compact(total(model.stats))} tokens  ·  ${price(model.stats)} · ${share(total(model.stats),scopeTotal)}`})),
      ...(scopeModels.length>4?[Text({dimColor:true,children:`+${scopeModels.length-4} more · Select Models to view all`})]:[]),
    ]}):null;
    const header=Box({flexDirection:'column',children:[
      Box({flexDirection:'row',gap:2,children:[Text({bold:true,children:'USAGE EXPLORER'}),Text({dimColor:true,children:state.loading?'⟳ Updating':'● Live · 5s'})]}),
      Text({dimColor:true,wrap:'truncate-end',children:state.periodLabel}),
      stats?Text({bold:true,children:`${compact(total(stats))} tokens   ${price(stats)} estimated API cost`}):Text({dimColor:true,children:'Loading local usage…'}),
      stats?Text({dimColor:true,children:`${stats.requests} requests · ${state.report.files} transcript files`}):null,
      Text({bold:true,children:'OFFICIAL ACCOUNT USAGE'}),
      ...(officialSpend?[
        Text({key:'official-spend-heading',bold:true,children:`${currencyAmount(officialSpend.used,officialSpend.currency)} / ${currencyAmount(officialSpend.limit,officialSpend.currency)} · ${officialSpend.percent.toFixed(1)}%`}),
        Text({key:'official-spend-bar',children:usageBar(officialSpend.percent,30)}),
        Text({key:'official-spend-left',dimColor:true,children:`${currencyAmount(Math.max(0,officialSpend.limit-officialSpend.used),officialSpend.currency)} remaining · official ${officialSpend.source}`}),
      ]:[]),
      ...officialLimitRows(limitState).filter(l=>!(officialSpend&&l.label==='extra_usage')).flatMap((l,i)=>[
        Text({key:`limit-name-${i}`,dimColor:true,children:`${l.label.replaceAll('_',' ')}${l.resetsAt?' · resets '+l.resetsAt:''}`}),
        Text({key:`limit-bar-${i}`,children:usageBar(l.percent)}),
      ]),
      ...(officialLimitRows(limitState).length===0?[Text({dimColor:true,children:`${limitState.status} · No supported limit values`})]:[]),
      Text({dimColor:true,children:'Official account spend and local API-equivalent estimates are separate.'}),
      Button({key:'check-official-limits',plain:true,label:'↻ Refresh official usage',onPress:()=>void checkLimits($,{force:true})}),
    ].filter(Boolean)});
    const footer=Box({flexDirection:'column',flexShrink:0,children:[
      Text({dimColor:true,children:'────────────────────────────────────────'}),
      Box({flexDirection:'row',gap:2,flexWrap:'wrap',children:[
        action('← Back','h',()=>change($,back(state))),
        action('↻ Refresh','r',()=>void refresh($)),
        action('◷ Period','p',()=>change($,{periodMenu:!state.periodMenu})),
        action(state.view==='models'?'← Close models':'▤ Models','m',models),
        action(state.sort==='tokens'?'↓ Tokens':'↓ Cost','s',()=>change($,{sort:state.sort==='tokens'?'cost':'tokens'})),
        ...(state.session?[
          action('Open session','o',()=>void sessionAction($,'open')),
          action('Copy ID','c',()=>void sessionAction($,'copy')),
        ]:[]),
        action('× Exit','x',()=>void $.ui.close({id:PANE})),
      ]}),
      Text({dimColor:true,children:'Esc: close · H: back · O: open current session · C: copy ID · X: exit'}),
    ]});
    return Box({flexDirection:'column',paddingX:1,flexGrow:1,minHeight:0,height:'100%',justifyContent:'space-between',children:[
      Box({flexDirection:'column',flexGrow:1,minHeight:0,children:[
      header,
      Text({dimColor:true,children:'────────────────────────────────────────'}),
      Text({bold:true,wrap:'truncate-end',children:breadcrumb}),
      Input({key:'usage-filter',placeholder:'Filter entries…',value:state.query,onInput:v=>change($,{query:v}),onSubmit:v=>change($,{query:typeof v==='string'?v:state.query})}),
      ...(state.periodMenu?[
        Text({bold:true,children:'SELECT PERIOD'}),
        Box({flexDirection:'column',gap:0,children:periodButtons}),
        Text({dimColor:true,children:'────────────────────────────────────────'}),
      ]:[]),
      ...(state.error?[Text({color:'red',wrap:'wrap',children:state.error})]:[]),
      ...(state.view==='models'?[action('← Back to previous view','h',()=>change($,back(state)))]:[]),
      ...(state.session?[Text({dimColor:true,children:`Session ID: ${state.session.id}`})]:[]),
      ...(state.agent&&state.agent.id!=='main'?[Text({dimColor:true,children:`Agent ID: ${state.agent.id}`})]:[]),
      ...(sessionActionStatus?[Text({dimColor:true,children:sessionActionStatus})]:[]),
      ...(modelSummary?[modelSummary]:[]),
      Box({flexDirection:'column',flexGrow:1,minHeight:0,children:[
        ...rows.slice(0,80).map((item,i)=>Button({key:`entry-${i}-${item.id}`,plain:true,onFocus:()=>{if(state.view==='sessions')focusedSessionId=item.id;},onPress:()=>press(item),label:`${item.label.slice(0,40)}  ·  ${compact(total(item.stats))}  ·  ${price(item.stats)} · ${share(total(item.stats),scopeTotal)}`})),
        ...(rows.length===0?[Text({dimColor:true,children:state.loading?'Loading entries…':'No matching entries.'})]:[]),
      ]}),
      ].filter(Boolean)}),
      footer,
    ]});

  });
}

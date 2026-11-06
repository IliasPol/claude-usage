// Claude Code native mod. The UI uses host components; local analytics run in a child Node process.
// No model requests are made when opening, navigating or refreshing this pane.
// Native hooks run in a restricted loader: no node: built-in imports.
// Convert the file URL using web-standard URL APIs, preserving Windows drive paths.
export function scriptPathFromModuleUrl(moduleUrl){
  const url=new URL('../bin/claude-usage.mjs',moduleUrl);
  let path=decodeURIComponent(url.pathname);
  if(/^\/[A-Za-z]:\//.test(path))path=path.slice(1);
  if(url.host&&url.host!=='localhost')path=`//${url.host}${path}`;
  return path;
}
const PANE='claude-usage-explorer';
const PERIODS=[['Billing cycle','cycle'],['Previous cycle','previous-cycle'],['All time','all'],['Today','today'],['Yesterday','yesterday'],['7 days','7d'],['30 days','30d'],['This month','month'],['Previous month','previous-month']];
let state={period:'all',view:'projects',stack:[],project:null,session:null,agent:null,report:null,periodLabel:'All time',loading:false,error:'',updatedAt:0,sort:'tokens',query:'',periodMenu:false,planUsage:null};
let timer=null;
let inFlight=null;
const total=s=>(s?.input||0)+(s?.output||0)+(s?.cacheRead||0)+(s?.cacheWrite||0);
const compact=n=>Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n||0);
const price=s=>s?.unknownCostRequests?'N/A':`$${(s?.knownCost||0).toFixed(2)}`;
export const agentLabel=a=>a?.id==='main'?'Agent (main)':(a?.name||a?.type||'Subagent');
const name=p=>String(p||'').replace(/\\/g,'/').split('/').filter(Boolean).pop()||p;
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
      // Refresh preserves the active drilldown; a missing session is handled by an empty list.
      change($,{report:snap.report,planUsage:snap.planUsage||null,periodLabel:snap.periodLabel,updatedAt:snap.updatedAt,loading:false,error:''});
    }catch(err){change($,{loading:false,error:String(err?.message||err).slice(0,260)});}
  })().finally(()=>{inFlight=null});
  return inFlight;
}
async function show($){await $.ui.open({id:PANE,title:'Claude Usage Explorer',focus:true,closeOnEscape:true});void refresh($);}
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
    timer?.cancel();timer=$.clock.every(5000,()=>void refresh($));
    return {text:'Usage Explorer opened in the sidebar. Navigation and refresh do not call the model.'};
  });
  on('ui.close',async ($,e,next)=>{if(e.id===PANE){timer?.cancel();timer=null;}return next(e);});
  on('session.end',async ($,e,next)=>{timer?.cancel();timer=null;return next(e);});
  on('ui.render',{component:'Pane',requestId:PANE},($,e,next)=>{
    if(e.surface!=='terminal'&&e.surface!=='desktop')return next(e);
    const {Box,Text,Button,Input}=$.ui.resolve(e);
    const rows=itemsFor();
    // Prefer the actual viewport row count when the host exposes it.
    // Percent heights are not consistently resolved in Claude terminal panes.
    const viewportRows=Number(e.presentation?.rows??e.viewport?.height??e.rows);
    const paneHeight=Number.isFinite(viewportRows)&&viewportRows>=16?Math.max(12,viewportRows-3):'100%';
    const press=item=>change($,drill(state,item));
    const models=()=>{if(state.view==='models'){change($,back(state));return;}change($,{...state,stack:[...state.stack,{view:state.view,project:state.project,session:state.session,agent:state.agent}],view:'models',query:''});};
    const periodButtons=PERIODS.map(([label,id])=>Button({key:`period-${id}`,plain:true,label:id===state.period?`● ${label}`:`  ${label}`,onPress:()=>{change($,{period:id,periodMenu:false});void refresh($);}}));
    const action=(label,hotkey,fn)=>Button({key:`action-${label}`,plain:true,label,hotkey,onPress:fn});
    const path=[state.project&&name(state.project),state.session?.title,state.agent&&agentLabel(state.agent)].filter(Boolean);
    const breadcrumb=`${state.view.toUpperCase()}${path.length?'  /  '+path.join(' / '):''}`;
    const stats=state.report?.overall;
    const plan=state.planUsage;
    const scopeModels=modelScope(state).slice().sort((a,b)=>total(b.stats)-total(a.stats));
    const showModelSummary=state.view!=='models'&&scopeModels.length>0;
    const divider=()=>Text({dimColor:true,children:'────────────────────────────────'});
    const header=Box({flexDirection:'column',gap:0,children:[
      Box({flexDirection:'row',gap:2,children:[Text({bold:true,children:'USAGE EXPLORER'}),Text({dimColor:true,children:state.loading?'Updating…':'● Auto · 5s'})]}),
      Text({dimColor:true,wrap:'truncate-end',children:state.periodLabel}),
      stats?Text({bold:true,children:`${compact(total(stats))} tokens  ·  ${price(stats)} est. API cost`}):Text({dimColor:true,children:'Loading local usage…'}),
      stats?Text({dimColor:true,children:`${stats.requests} requests  ·  ${state.report.files} files`}):null,
    ].filter(Boolean)});
    const planSection=Box({flexDirection:'column',gap:0,children:[
      Text({bold:true,children:'PLAN LIMITS'}),
      plan?Text({children:`5-hour ${plan.fiveHour??'—'}%   ·   7-day ${plan.sevenDay??'—'}%`}):Text({dimColor:true,children:'Desktop usage cache unavailable'}),
      plan?Text({dimColor:true,wrap:'truncate-end',children:`${plan.stale?'Cached · May be outdated':'Cached · Recently updated'} · ${new Date(plan.timestamp).toLocaleString()}`}):null,
    ].filter(Boolean)});
    const modelSummary=showModelSummary?Box({flexDirection:'column',children:[
      Text({bold:true,children:'MODEL BREAKDOWN'}),
      ...scopeModels.slice(0,3).map((model,i)=>Text({key:`model-summary-${i}`,dimColor:true,wrap:'truncate-end',children:`${model.name} · ${compact(total(model.stats))} · ${price(model.stats)}`})),
      ...(scopeModels.length>3?[Text({dimColor:true,children:`+${scopeModels.length-3} more (M to view)`})]:[]),
    ]}):null;
    // Keep the action strip separate from the growing list. Host layout decides
    // whether a 100%-height pane is available; do not claim fixed positioning.
    const footer=Box({flexDirection:'column',flexShrink:0,children:[
      divider(),
      Box({flexDirection:'row',gap:1,flexWrap:'wrap',children:[
        action('← Back','h',()=>change($,back(state))),
        action('↻ Refresh','r',()=>void refresh($)),
        action('◷ Period','p',()=>change($,{periodMenu:!state.periodMenu})),
        action(state.view==='models'?'← Close models':'▤ Models','m',models),
        action(state.sort==='tokens'?'↓ Tokens':'↓ Cost','s',()=>change($,{sort:state.sort==='tokens'?'cost':'tokens'})),
        action('× Exit','x',()=>void $.ui.close({id:PANE})),
      ]}),
      Text({dimColor:true,wrap:'truncate-end',children:'Esc close · H back · R refresh · P period · M models · S sort'}),
    ]});
    return Box({flexDirection:'column',paddingX:1,flexGrow:1,minHeight:0,height:paneHeight,justifyContent:'space-between',children:[
      Box({flexDirection:'column',flexGrow:1,minHeight:0,children:[
        header,
        divider(),
        planSection,
        divider(),
        Text({bold:true,wrap:'truncate-end',children:breadcrumb}),
        ...(state.agent?.id&&state.agent.id!=='main'?[Text({dimColor:true,children:`Agent ID: ${state.agent.id}`})]:[]),
        Input({key:'usage-filter',placeholder:'Search projects / sessions…',value:state.query,onInput:v=>change($,{query:v}),onSubmit:v=>change($,{query:typeof v==='string'?v:state.query})}),
        ...(state.periodMenu?[
          Text({bold:true,children:'CHOOSE PERIOD'}),
          Box({flexDirection:'column',gap:0,children:periodButtons}),
          divider(),
        ]:[]),
        ...(state.error?[Text({color:'red',wrap:'wrap',children:state.error})]:[]),
        ...(state.view==='models'?[action('← Back to previous view','h',()=>change($,back(state)))]:[]),
        Box({flexDirection:'column',flexGrow:1,minHeight:0,children:[
          ...rows.slice(0,80).map((item,i)=>Button({key:`entry-${i}-${item.id}`,plain:true,onPress:()=>press(item),label:`${item.label.slice(0,36)} · ${compact(total(item.stats))} · ${price(item.stats)}`})),
          ...(rows.length===0?[Text({dimColor:true,children:state.loading?'Loading entries…':'No matching entries.'})]:[]),
        ]}),
        ...(modelSummary?[divider(),modelSummary]:[]),
      ].filter(Boolean)}),
      footer,
    ]});

  });
}

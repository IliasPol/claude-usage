import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {drill,back,itemsFor,modelScope,register} from '../hooks/usage-explorer.mjs';
const stats={input:5,output:2,cacheWrite:0,cacheRead:10,knownCost:0.25,unknownCostRequests:0};
const agent={id:'main',stats,models:[{name:'sonnet',stats}]};
const session={id:'s1',title:'Build feature',project:'/repo',stats,agents:[agent],models:agent.models};
const report={overall:stats,projects:[{name:'/repo',stats}],sessions:[session],models:agent.models,files:1};
test('native mod drills projects, sessions, agents and models, and navigates back',()=>{
 let state={view:'projects',stack:[],project:null,session:null,agent:null,report,sort:'tokens',query:''};
 state=drill(state,itemsFor(state)[0]);assert.equal(state.view,'sessions');
 state=drill(state,itemsFor(state)[0]);assert.equal(state.view,'agents');
 state=drill(state,itemsFor(state)[0]);assert.equal(state.view,'models');
 assert.equal(itemsFor(state)[0].label,'sonnet');
 state=back(state);assert.equal(state.view,'agents');
 state=back(state);assert.equal(state.view,'sessions');
 state=back(state);assert.equal(state.view,'projects');
});
test('native mod registers a model-free immediate command',async()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const start=hooks.find(x=>x.event==='session.start');
 let command;
 await start.fn({command:{register:async c=>{command=c;}}},{},async()=>({}));
 assert.equal(command.name,'usage-explorer');assert.equal(command.immediate,true);
});
test('native sidebar render includes clickable entries and period controls',async()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,matcher,fn}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 assert.equal(element.type,'Box');
 assert.ok(element.children.some(x=>x?.type==='Box'));
 const flat=node=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 const input=flat(element).find(x=>x?.type==='Input');
 assert.equal(input?.key,'usage-filter','host requires a stable key on Input');
 assert.equal(typeof input?.onSubmit,'function','Claude Code 2.1.311 requires onSubmit for Input');
});

test('native sidebar collapses period choices and puts actions after entries',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 const flat=(node)=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 const all=flat(element);
 assert.ok(all.some(x=>x.type==='Button'&&x.label==='◷ Period'));
 assert.ok(!all.some(x=>x.type==='Button'&&x.key==='period-cycle'));
 assert.ok(all.some(x=>x.type==='Input'&&x.key==='usage-filter'));
 const last=element.children[element.children.length-1];
 assert.ok(flat(last).some(x=>x.type==='Button'&&x.label==='↻ Refresh'));
});


test('model scope respects project, session and agent drilldown',()=>{
 const other={name:'opus',stats:{...stats,input:30}};
 const scoped={...report,models:[other],projects:[{name:'/repo',stats,models:[{name:'sonnet',stats}]}]};
 const base={view:'projects',stack:[],project:null,session:null,agent:null,report:scoped,sort:'tokens',query:''};
 assert.equal(modelScope(base)[0].name,'opus');
 const projectState={...base,project:'/repo'};
 assert.equal(modelScope(projectState)[0].name,'sonnet');
 const sessionState={...projectState,session};
 assert.equal(modelScope(sessionState)[0].name,'sonnet');
 const agentState={...sessionState,agent};
 assert.equal(modelScope(agentState)[0].name,'sonnet');
});

test('models screen has a prominent back control and footer close-models action',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 const flat=node=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 assert.match(requireSource(),/MODEL USAGE/);
 const modSource=requireSource();
 assert.match(modSource,/Back to previous view/);
 assert.match(modSource,/Close models/);
});
function requireSource(){return requireSource.text||(requireSource.text=readFileSync(new URL('../hooks/usage-explorer.mjs',import.meta.url),'utf8'));}


test('native sidebar uses host close-on-Escape and offers explicit exit action',async()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const run=hooks.find(x=>x.event==='command.run').fn;
 let opened;
 const $={session:{surfaces:async()=>['desktop']},ui:{open:async p=>{opened=p},invalidate:async()=>{},close:async()=>{}},process:{run:async()=>({exitCode:1,stderr:'fixture'})},clock:{every:()=>({cancel(){}})}};
 await run($,{presentation:{isFullscreen:true,columns:160}});
 assert.equal(opened.closeOnEscape,true);
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 const flat=node=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 const exit=flat(element).find(x=>x.type==='Button'&&x.label==='× Exit');
 assert.equal(exit.hotkey,'x');assert.equal(typeof exit.onPress,'function');
});

test('period choices stack vertically and footer is outside expanding content',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 assert.equal(element.justifyContent,'space-between');
 assert.equal(element.height,'100%');
 assert.equal(element.children.length,2);
 assert.equal(element.children[0].flexGrow,1);
 assert.equal(element.children[1].flexShrink,0);
 const source=readFileSync(new URL('../hooks/usage-explorer.mjs',import.meta.url),'utf8');
 assert.match(source,/flexDirection:'column',gap:0,children:periodButtons/);
});

test('official usage bars clamp percentages and show enterprise extra usage',async()=>{
 const {usageBar,officialLimitRows}=await import('../hooks/usage-explorer.mjs');
 assert.match(usageBar(37.66,10),/37\.7%/);
 assert.match(usageBar(130,10),/100\.0%/);
 assert.match(usageBar(-1,10),/0\.0%/);
 const rows=officialLimitRows({rateLimits:[],details:['extra_usage: utilization: 37.66 · is_enabled: true']});
 assert.deepEqual(rows,[{label:'extra_usage',percent:37.66,resetsAt:''}]);
});

test('usage response diagnostic exposes field names and types only',async()=>{
 const {usageSchema}=await import('../hooks/usage-explorer.mjs');
 const fields=usageSchema({extra_usage:{utilization:37.66,resets_at:'secret-date'},billing:{cycle_start:'private',cap:200},some_id:'private-id'});
 assert.ok(fields.includes('extra_usage.utilization: number'));
 assert.ok(fields.includes('billing.cycle_start: string'));
 assert.ok(!fields.join(' ').includes('private'));
 assert.ok(!fields.join(' ').includes('37.66'));
});


test('native mod uses only supported single-letter or digit hotkeys',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 const flat=node=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 const buttons=flat(element).filter(x=>x.type==='Button');
 for(const b of buttons){if(b.hotkey!==undefined)assert.match(b.hotkey,/^[a-z0-9]$/,`invalid hotkey on ${b.label}`);}
 assert.equal(buttons.some(b=>b.label==='Help'),false);
});


test('native sidebar removes diagnostic and provides session open actions',async()=>{
 const {sessionResumeCommand}=await import('../hooks/usage-explorer.mjs');
 const command=sessionResumeCommand({id:'bf9de351-f0e6-48cc-a941-21e3705fe379',project:'/Users/example/my repo'});
 assert.match(command,/claude --resume/);
 assert.match(command,/my repo/);
 assert.throws(()=>sessionResumeCommand({id:'bad',project:'/repo'}));
 const source=readFileSync(new URL('../hooks/usage-explorer.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Show response fields|Hide response fields|USAGE RESPONSE FIELD TYPES/);
 assert.doesNotMatch(source,/session-open-terminal|session-copy-id/);
 assert.match(source,/action\('Open session','o'/);
 assert.match(source,/action\('Copy ID','c'/);
});

import { readFileSync as readModSource } from "node:fs";
import { fileURLToPath as modFilePath } from "node:url";
import { dirname as modDirname, join as modJoin } from "node:path";
test("session actions use focused session from list and parent session deeper", async () => {
 const {selectedSessionForAction}=await import('../hooks/usage-explorer.mjs');
 const a={...session,id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'};
 const b={...session,id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'};
 const s={view:'sessions',project:'/repo',report:{...report,sessions:[a,b]}};
 assert.equal(selectedSessionForAction(s,b.id),b);
 assert.equal(selectedSessionForAction(s,null),null);
 assert.equal(selectedSessionForAction({...s,view:'agents',session:a},b.id),a);
 const source=requireSource();
 assert.match(source,/onFocus:\(\)=>\{if\(state.view==='sessions'\)focusedSessionId=item.id/);
 assert.doesNotMatch(source,/key:'session-open-terminal'|key:'session-copy-id'/);
});

test('agent rows hide IDs until drilldown and show main label',async()=>{
 const {agentLabel}=await import('../hooks/usage-explorer.mjs');
 assert.equal(agentLabel({id:'main'}),'Agent (main)');
 assert.equal(agentLabel({id:'af22fd9030fbd751f'}),'Subagent');
 assert.equal(agentLabel({id:'af22fd9030fbd751f',name:'code-reviewer'}),'code-reviewer');
 const state={view:'agents',stack:[],project:'/repo',session:{...session,id:'different-session',agents:[{...agent,id:'af22fd9030fbd751f',name:'code-reviewer'}]},agent:null,report,sort:'tokens',query:''};
 assert.equal(itemsFor(state)[0].label,'code-reviewer');
});

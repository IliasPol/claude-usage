import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {drill,back,itemsFor,modelScope,register,scriptPathFromModuleUrl} from '../hooks/usage-explorer.mjs';
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
 assert.match(requireSource(),/MODEL BREAKDOWN/);
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

test('native sidebar converts file URLs to OS paths, including Windows drive letters',()=>{
 const source=requireSource();
 assert.match(source,/scriptPathFromModuleUrl\(import\.meta\.url\)/);
 assert.doesNotMatch(source,/decodeURIComponent\(new URL\('\.\.\/bin\/claude-usage\.mjs'/);
});

test('native hook resolves macOS and Windows paths without node built-in imports',()=>{
 assert.equal(scriptPathFromModuleUrl('file:///Users/example/plugin/hooks/usage-explorer.mjs'),'/Users/example/plugin/bin/claude-usage.mjs');
 assert.equal(scriptPathFromModuleUrl('file:///C:/Users/example/plugin/hooks/usage-explorer.mjs'),'C:/Users/example/plugin/bin/claude-usage.mjs');
 assert.equal(scriptPathFromModuleUrl('file:///C:/Users/Test%20User/plugin/hooks/usage-explorer.mjs'),'C:/Users/Test User/plugin/bin/claude-usage.mjs');
 assert.doesNotMatch(requireSource(),/from ['"]node:/);
});

test('sidebar separates cached plan limits from API estimates and keeps concise controls',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal'},()=>null);
 const flat=node=>[node,...(Array.isArray(node?.children)?node.children:[]).flatMap(flat)];
 const all=flat(element);
 assert.ok(all.some(x=>x.type==='Text'&&x.children==='PLAN LIMITS'));
 assert.ok(all.some(x=>x.type==='Text'&&String(x.children).includes('est. API cost')) || all.some(x=>x.type==='Text'&&String(x.children).includes('Loading local usage')));
 assert.ok(all.some(x=>x.type==='Text'&&String(x.children).includes('Esc close')));
 assert.equal(element.children.at(-1).flexShrink,0);
});


test('native pane uses supplied terminal viewport rows to reserve bottom footer',()=>{
 const hooks=[];register((event,matcher,fn)=>hooks.push({event,fn:fn||matcher}));
 const render=hooks.find(x=>x.event==='ui.render').fn;
 const ui={resolve:()=>Object.fromEntries(['Box','Text','Button','Input'].map(k=>[k,p=>({type:k,...p})]))};
 const element=render({ui},{surface:'terminal',presentation:{rows:42}},()=>null);
 assert.equal(element.height,39);
 assert.equal(element.children.at(-1).flexShrink,0);
});

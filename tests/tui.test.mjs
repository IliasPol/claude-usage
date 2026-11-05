import test from 'node:test';
import assert from 'node:assert/strict';
import {createExplorer,describePeriod} from '../src/tui.mjs';
const z={input:3,output:2,cacheRead:5,cacheWrite:1,model:'claude-sonnet-4-5',timestamp:Date.now()};
const data={sessions:[{id:'s1',title:'Example session',cwd:'/tmp/demo',start:Date.now(),end:Date.now(),agents:new Map([['main',{id:'main',requests:[z]}]])}],files:1,malformed:0,roots:[]};
test('TUI drills from project to session to agent to model without LLM',()=>{
 const x=createExplorer(data,{period:'all',cwd:'/tmp/demo',settings:{}});
 assert.equal(x.rows().length,1);
 assert.match(x.render(115,30),/CLAUDE USAGE EXPLORER/);
 x.open();assert.equal(x.view,'sessions');assert.equal(x.rows()[0].title,'Example session');
 x.open();assert.equal(x.view,'agents');assert.equal(x.rows()[0].id,'main');
 x.open();assert.equal(x.view,'models');assert.equal(x.rows()[0].name,'claude-sonnet-4-5');
 x.restore();assert.equal(x.view,'agents');
});
test('TUI switches dates and shows model columns',()=>{
 const x=createExplorer(data,{period:'all',settings:{}});
 x.nav('periods');const i=x.rows().findIndex(x=>x.value==='today');x.selection=i;x.open();
 assert.equal(x.currentPeriod,'today');assert.match(x.render(120,30),/C.READ/);
});
test('TUI shows models for selected project without drilling into sessions',()=>{
 const x=createExplorer(data,{period:'all',settings:{}});
 assert.match(x.render(130,32),/MODEL BREAKDOWN · SELECTED ROW/);
 assert.match(x.render(130,32),/claude-sonnet-4-5/);
 x.setSort('output');assert.equal(x.sort,'output');
});
test('TUI displays unknown model pricing as N/A, never a misleading zero',()=>{
 const unknown={...z,model:'claude-unknown-9-9'};
 const d={...data,sessions:[{...data.sessions[0],agents:new Map([['main',{id:'main',requests:[unknown]}]])}]};
 const x=createExplorer(d,{period:'all',settings:{}});
 assert.match(x.render(130,32),/N\/A/);
});
test('TUI footer and model panel remain at fixed rows as selection changes',()=>{
 const extra={...data.sessions[0],id:'s2',title:'Another session',cwd:'/tmp/other'};
 const x=createExplorer({...data,sessions:[...data.sessions,extra]},{period:'all',settings:{}});
 const a=x.render(120,32).split('\n');
 x.selection=1;
 const b=x.render(120,32).split('\n');
 for(const label of ['MODEL BREAKDOWN · SELECTED ROW','Billing/settings','PgUp/PgDn scroll']){
  const index=lines=>lines.findIndex(line=>line.includes(label));
  assert.equal(index(a),index(b),label);
 }
 assert.equal(a.length,b.length);
});

test('billing periods appear first and require configuration before selection',()=>{
 const x=createExplorer(data,{period:'all',settings:{}});
 x.nav('periods');
 assert.equal(x.rows()[0].value,'cycle');
 assert.equal(x.rows()[1].value,'previous-cycle');
 assert.equal(x.open(),'billing-required:cycle');
 assert.equal(x.currentPeriod,'all');
 x.setBillingDay(5,'Europe/Athens',10,30);
 assert.equal(x.open(),null);
 assert.equal(x.currentPeriod,'cycle');
});
test('custom date selection requests input instead of navigating or quitting',()=>{
 const x=createExplorer(data,{period:'all',settings:{}});
 x.nav('periods');
 x.selection=x.rows().findIndex(r=>r.value==='custom');
 assert.equal(x.open(),'custom');
 assert.equal(x.view,'periods');
 x.setPeriod('2026-11-01:2026-11-05');
 assert.equal(x.currentPeriod,'2026-11-01:2026-11-05');
});

test('billing date choices and header show descriptive date ranges',()=>{
 const settings={billingDay:1,billingTimeZone:'UTC',billingHour:0,billingMinute:0};
 assert.equal(describePeriod('cycle',settings,Date.UTC(2026,10,5)),'Current billing cycle · Nov 1, 2026 – Nov 30, 2026');
 assert.equal(describePeriod('previous-cycle',settings,Date.UTC(2026,10,5)),'Previous billing cycle · Oct 1, 2026 – Oct 31, 2026');
 assert.match(describePeriod('cycle',{},Date.UTC(2026,10,5)),/Set renewal date/);
 const x=createExplorer(data,{settings,period:'cycle'});
 assert.match(x.render(130,32),/Current billing cycle/);
 x.nav('periods');
 assert.match(x.rows()[0].label,/Nov/);
});

test('live refresh preserves project, session, sorting, and period',()=>{
 const x=createExplorer(data,{cwd:'/tmp/demo',settings:{}});
 x.open();x.open();
 x.setSort('output');x.setPeriod('today');
 // Date changes intentionally reset the view; navigate back into the session.
 x.open();x.open();
 assert.equal(x.view,'agents');
 x.rescan([], {automatic:true});
 assert.equal(x.currentPeriod,'today');
 assert.equal(x.sort,'output');
 assert.equal(x.view,'projects'); // source was removed by rescan
 x.toggleLive();assert.equal(x.liveState.enabled,false);
 x.toggleLive();assert.equal(x.liveState.enabled,true);
});

test('file signature changes only when JSONL metadata changes', async()=>{
 const {historySignature}=await import('../src/tui.mjs');
 const fs=await import('node:fs');
 const os=await import('node:os');
 const path=await import('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-live-'));
 try{
  const file=path.join(root,'a.jsonl');
  fs.writeFileSync(file,'a');const a=historySignature([root]);
  assert.equal(a,historySignature([root]));
  fs.appendFileSync(file,'bc');assert.notEqual(a,historySignature([root]));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('TUI displays cached Desktop plan usage and refreshes it without a model call',()=>{
 let calls=0;let current=1;
 const x=createExplorer(data,{period:'all',settings:{},planReader:()=>{calls++;return {fiveHour:current,sevenDay:32,timestamp:Date.now()};}});
 assert.match(x.render(120,32),/5h 1%/);
 assert.match(x.render(120,32),/7d 32%/);
 current=9; x.refreshPlan(Date.now()+5000);
 assert.match(x.render(120,32),/5h 9%/);
 assert.ok(calls>=2);
});

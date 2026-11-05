import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseFile,ingest,summarize,timeWindow,totalTokens,projectRoots} from '../src/core.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-usage-test-'));
const root=path.join(dir,'projects','-sample');fs.mkdirSync(root,{recursive:true});
const file=path.join(root,'session-123.jsonl');
const write=(f,rows)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');};
const assistant=(id,output,ts='2026-10-12T12:00:00Z')=>({type:'assistant',timestamp:ts,cwd:'/sample',sessionId:'session-123',message:{id,model:'claude-sonnet-4-5-20250929',usage:{input_tokens:100,output_tokens:output,cache_creation_input_tokens:20,cache_read_input_tokens:500}}});
write(file,[{type:'user',timestamp:'2026-10-12T11:59:00Z',cwd:'/sample',sessionId:'session-123',message:{content:'Implement the API'}},assistant('msg1',3),assistant('msg1',10),assistant('msg2',5)]);
test('deduplicates repeated message IDs using max observed counters',()=>{const p=parseFile(file);assert.equal(p.requests.length,2);assert.equal(p.requests[0].output,10);assert.equal(p.title,'Implement the API');});
test('aggregates model usage without counting streaming duplicates',()=>{const d=ingest([path.join(dir,'projects')]);const s=summarize(d);assert.equal(s.overall.requests,2);assert.equal(s.overall.output,15);assert.equal(totalTokens(s.overall),100*2+15+20*2+500*2);assert.equal(s.projects.length,1);});
test('subagent file appears in same session',()=>{const child=path.join(root,'session-123','subagents','agent-abc.jsonl');write(child,[assistant('msg3',8)]);const d=ingest([path.join(dir,'projects')]);assert.equal(d.sessions.length,1);assert.equal(d.sessions[0].agents.size,2);const s=summarize(d);assert.equal(s.overall.requests,3);assert.equal(s.sessions[0].agents.length,2);});
test('date filtering attributes usage by request timestamp',()=>{const d=ingest([path.join(dir,'projects')]);assert.equal(summarize(d,timeWindow('2026-10-13:2026-10-14')).overall.requests,0);assert.equal(summarize(d,timeWindow('2026-10-12:2026-10-12')).overall.requests,3);});
test('billing period clamps month end',()=>{const now=Date.parse('2026-03-02T12:00:00Z');const [a,b]=timeWindow('cycle',now,31);assert.equal(new Date(a).toISOString(),'2026-02-28T00:00:00.000Z');assert.equal(new Date(b).toISOString(),'2026-03-31T00:00:00.000Z');});
test('config dir discovery honors custom root',()=>{const roots=projectRoots({CLAUDE_CONFIG_DIR:'/tmp/custom'},'/home/test');assert.ok(roots.includes(path.resolve('/tmp/custom/projects')));});
test('unknown pricing is reported instead of zero-cost certainty',()=>{const unknown=path.join(root,'unknown.jsonl');write(unknown,[{...assistant('unknown',2),sessionId:'unknown',message:{...assistant('unknown',2).message,model:'claude-future-unknown'}}]);const s=summarize(ingest([path.join(dir,'projects')]));assert.equal(s.overall.unknownCostRequests,1);});

test('Sonnet 5.5 official base prices yield nonzero API equivalent cost', async()=>{
 const {costFor}=await import('../src/core.mjs');
 const price=costFor('claude-sonnet-5-5',{input:1000000,output:1000000,cacheWrite:1000000,cacheRead:1000000});
 assert.equal(price,14.6);
});
test('billing timezone and local time determine cycle boundaries',async()=>{
 const {timeWindow}=await import('../src/core.mjs');
 const now=Date.parse('2026-11-05T10:00:00Z');
 const [start,end]=timeWindow('cycle',now,5,'Europe/Athens',9,0);
 assert.equal(new Date(start).toISOString(),'2026-11-05T07:00:00.000Z');
 assert.equal(new Date(end).toISOString(),'2026-12-05T07:00:00.000Z');
});

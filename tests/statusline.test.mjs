import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {formatStatusLine,installStatusLine} from '../src/statusline.mjs';
test('statusline distinguishes live session cost and historical cycle estimate',()=>{
 const result=formatStatusLine({model:{display_name:'Claude Sonnet'},cost:{total_cost_usd:1.234}}, {cycle:{input:1000,output:0,cacheWrite:0,cacheRead:0,knownCost:12.5,unknownCostRequests:0}});
 assert.match(result,/Session \$1\.23/);assert.match(result,/Cycle \$12\.50/);
});
test('install preserves other settings, refuses overwrite, and backs up',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-status-'));
 try{const file=path.join(dir,'settings.json');fs.writeFileSync(file,JSON.stringify({theme:'dark',statusLine:{type:'command',command:'echo previous'}}));
 assert.throws(()=>installStatusLine({settingsPath:file,scriptPath:'/tmp/usage.mjs'}),/already/);
 installStatusLine({settingsPath:file,scriptPath:'/tmp/usage.mjs',force:true});
 const settings=JSON.parse(fs.readFileSync(file));assert.equal(settings.theme,'dark');assert.match(settings.statusLine.command,/statusline/);
 assert.ok(fs.readdirSync(dir).some(f=>f.includes('backup')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

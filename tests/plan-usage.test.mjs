import test from 'node:test';
import assert from 'node:assert/strict';
import {planUsageFromSamples,readPlanUsage} from '../src/plan-usage.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('reads newest cached percentages without organization identifiers',()=>{
 const result=planUsageFromSamples([{t:1000,org:'private',u:{fh:8,sd:12}},{t:2000,org:'secret',u:{fh:1,sd:0}}],2000000);
 assert.equal(result.fiveHour,1);assert.equal(result.sevenDay,0);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('missing cache is optional',()=>assert.equal(readPlanUsage({platform:'win32',localAppData:'Z:/nonexistent'}),null));
test('reads Windows Claude-Data cache',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-plan-'));
 try{const folder=path.join(tmp,'Claude-Data','claude_test');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'plan-usage-history.json'),JSON.stringify({version:2,samples:[{t:1700000000000,u:{fh:14,sd:44},org:'hidden'}]}));
 const result=readPlanUsage({platform:'win32',localAppData:tmp,now:1700000000000});assert.equal(result.fiveHour,14);assert.equal(result.sevenDay,44);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

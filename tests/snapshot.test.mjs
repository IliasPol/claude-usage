import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {snapshot} from '../src/snapshot.mjs';
test('snapshot reads configured billing cycle and reports no external data',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'usage-mod-'));
 try {
  fs.mkdirSync(path.join(home,'.claude-usage-explorer'));
  fs.writeFileSync(path.join(home,'.claude-usage-explorer','settings.json'),JSON.stringify({billingDay:1,billingTimeZone:'UTC'}));
  const data=snapshot(['--period','cycle'],{now:Date.UTC(2026,10,5),home,roots:[]});
  assert.match(data.periodLabel,/Nov 1, 2026/);assert.equal(data.report.overall.requests,0);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {screenDiff,clipAnsi,createExplorer} from '../src/tui.mjs';
test('only updates changed lines and never clears the full screen',()=>{
 const result=screenDiff('one\ntwo\nthree','one\nTWO\nthree');
 assert.equal(result,'\x1b[2;1H\x1b[2KTWO');
 assert.ok(!result.includes('\x1b[2J'));
});
test('clears removed lines and renders initial frame',()=>{
 assert.equal(screenDiff('a\nb','a'),'\x1b[2;1H\x1b[2K');
 assert.equal(screenDiff(null,'a\nb'),'\x1b[1;1H\x1b[2Ka\x1b[2;1H\x1b[2Kb');
});

test('colored rows are clipped without breaking ANSI reset',()=>{
 const text='\x1b[31m'+('x'.repeat(100))+'\x1b[0m';
 assert.equal(clipAnsi(text,10),'\x1b[31mxxxxxxxxxx\x1b[0m');
});
test('short terminals never receive a frame filling the last row',()=>{
 const explorer=createExplorer({sessions:[],files:0,malformed:0,roots:[]},{cwd:process.cwd()});
 const lines=explorer.render(45,18).split('\n');
 assert.ok(lines.length<=17);
 assert.ok(lines.every(line=>line.replace(/\x1b\[[0-9;]*m/g,'').length<=44));
});

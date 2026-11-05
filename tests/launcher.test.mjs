import test from 'node:test';
import assert from 'node:assert/strict';
import {launchSidecar} from '../src/launcher.mjs';
test('macOS sidecar launches separate Terminal with current project',()=>{
 let invocation;
 const spawnProcess=(program,args,opts)=>{invocation={program,args,opts};return {on(){},unref(){}};};
 launchSidecar({platform:'darwin',cwd:'/tmp/my project',spawnProcess});
 assert.equal(invocation.program,'osascript');
 assert.match(invocation.args.join(' '),/Terminal/);
 assert.match(invocation.args.join(' '),/my project/);
 assert.equal(invocation.opts.detached,true);
});

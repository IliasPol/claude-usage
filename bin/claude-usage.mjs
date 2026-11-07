#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/core.mjs';
import { launchTui } from '../src/tui.mjs';
import { snapshot } from '../src/snapshot.mjs';
import {runStatusLine,installStatusLine} from '../src/statusline.mjs';
import {launchSidecar} from '../src/launcher.mjs';
(process.argv[2] === 'preference' ? Promise.resolve().then(()=>{const file=path.join(os.homedir(),'.claude-usage-explorer','settings.json');let obj={};try{obj=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(process.argv[3]==='period' && ['all','cycle','previous-cycle','today','yesterday','7d','30d','month','previous-month'].includes(process.argv[4])){obj.lastPeriod=process.argv[4];fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n',{mode:0o600});}else throw Error('Invalid preference');}) : process.argv[2] === 'open' ? Promise.resolve(launchSidecar({cwd:process.env.CLAUDE_PROJECT_DIR||process.cwd()})).then(()=>console.log('Opened Claude Usage Explorer in a separate terminal.')) : process.argv[2] === 'snapshot' ? Promise.resolve(snapshot(process.argv.slice(3))).then(data=>console.log(JSON.stringify(data))) : process.argv[2] === 'tui' ? launchTui(process.argv.slice(3)) : process.argv[2] === 'statusline' ? runStatusLine() : process.argv[2] === 'statusline-install' ? Promise.resolve(console.log('Installed status line in',installStatusLine({force:process.argv.includes('--force')}))) : main(process.argv.slice(2))).catch(err => { console.error('Error:', err.message); process.exitCode = 1; });

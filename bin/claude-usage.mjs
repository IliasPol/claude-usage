#!/usr/bin/env node
import { main } from '../src/core.mjs';
import { launchTui } from '../src/tui.mjs';
import { snapshot } from '../src/snapshot.mjs';
import {runStatusLine,installStatusLine} from '../src/statusline.mjs';
import {launchSidecar} from '../src/launcher.mjs';
(process.argv[2] === 'open' ? Promise.resolve(launchSidecar({cwd:process.env.CLAUDE_PROJECT_DIR||process.cwd()})).then(()=>console.log('Opened Claude Usage Explorer in a separate terminal.')) : process.argv[2] === 'snapshot' ? Promise.resolve(snapshot(process.argv.slice(3))).then(data=>console.log(JSON.stringify(data))) : process.argv[2] === 'tui' ? launchTui(process.argv.slice(3)) : process.argv[2] === 'statusline' ? runStatusLine() : process.argv[2] === 'statusline-install' ? Promise.resolve(console.log('Installed status line in',installStatusLine({force:process.argv.includes('--force')}))) : main(process.argv.slice(2))).catch(err => { console.error('Error:', err.message); process.exitCode = 1; });

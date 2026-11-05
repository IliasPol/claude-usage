import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

const cliPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../bin/claude-usage.mjs');
const shQuote=s=>`'${String(s).replaceAll("'", "'\\''")}'`;
const appleQuote=s=>`"${String(s).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`;

/** Opens a real interactive TTY beside Claude; cannot embed a TUI in Claude's tool output. */
export function launchSidecar({cwd=process.cwd(),platform=process.platform,spawnProcess=spawn,probe=spawnSync}={}){
 const command=[shQuote(process.execPath),shQuote(cliPath),'tui','--cwd',shQuote(cwd)].join(' ');
 let program,args;
 if(platform==='darwin'){
  program='osascript';args=['-e',`tell application "Terminal" to do script ${appleQuote(command)}`,'-e','tell application "Terminal" to activate'];
 }else if(platform==='win32'){
  // Pass arguments as a PowerShell literal array; do not interpolate a shell command.
  const psQuote=s=>`'${String(s).replaceAll("'","''")}'`;
  const ps=`Start-Process -FilePath ${psQuote('cmd.exe')} -ArgumentList @('/k', ${psQuote('"'+process.execPath+'" "'+cliPath+'" tui --cwd "'+cwd+'"')})`;
  program='powershell.exe';args=['-NoProfile','-NonInteractive','-Command',ps];
 }else{
  const choices=[['x-terminal-emulator',['-e','sh','-c',command]],['gnome-terminal',['--','sh','-c',command]],['konsole',['-e','sh','-c',command]],['xterm',['-e','sh','-c',command]]];
  const chosen=choices.find(([name])=>probe('which',[name],{stdio:'ignore'}).status===0);
  if(!chosen)throw new Error('No supported terminal emulator found. Run `claude-usage tui` in another terminal.');
  [program,args]=chosen;
 }
 const child=spawnProcess(program,args,{detached:true,stdio:'ignore',windowsHide:false});
 child.on?.('error',err=>console.error('Unable to launch terminal:',err.message));
 child.unref?.();
 return {program,args};
}

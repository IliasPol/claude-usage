import fs from 'node:fs';
import path from 'node:path';

// Claude Desktop's plan-usage-history.json is undocumented, optional cached data.
// Read only known numeric utilization fields; never expose organization identifiers.
export function planUsageFromSamples(samples, now=Date.now()) {
  if (!Array.isArray(samples)) return null;
  const valid=samples.filter(s=>s && Number.isFinite(s.t) && s.u &&
    (Number.isFinite(s.u.fh)||Number.isFinite(s.u.sd)))
    .map(s=>({timestamp:s.t<1e12?s.t*1000:s.t,
      fiveHour:Number.isFinite(s.u.fh)?s.u.fh:null,
      sevenDay:Number.isFinite(s.u.sd)?s.u.sd:null}))
    .filter(s=>s.timestamp>0 && s.timestamp<=now+86400000)
    .sort((a,b)=>a.timestamp-b.timestamp);
  if (!valid.length)return null;
  const latest=valid.at(-1);
  return { ...latest, stale:now-latest.timestamp>15*60*1000,
    samples:valid.slice(-100),source:'Claude Desktop cached history'};
}
export function readPlanUsage({platform=process.platform,localAppData=process.env.LOCALAPPDATA,home=process.env.HOME,now=Date.now()}={}){
  const roots=[];
  if(platform==='win32'&&localAppData)roots.push(path.join(localAppData,'Claude-Data'));
  if(platform==='darwin'&&home){roots.push(path.join(home,'Library','Application Support','Claude-Data'));roots.push(path.join(home,'Library','Application Support','Claude'));}
  let best=null;
  for(const root of roots){
    let folders=[];
    try{folders=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith('claude_')).map(x=>path.join(root,x.name));}catch{continue;}
    for(const folder of folders){
      try{
        const file=path.join(folder,'plan-usage-history.json');
        if(fs.statSync(file).size>2_000_000)continue;
        const data=JSON.parse(fs.readFileSync(file,'utf8'));
        const result=planUsageFromSamples(data.samples,now);
        if(result&&(!best||result.timestamp>best.timestamp))best=result;
      }catch{}
    }
  }
  return best;
}

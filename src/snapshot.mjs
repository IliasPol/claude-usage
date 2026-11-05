import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_RATES,ingest,projectRoots,summarize,timeWindow} from './core.mjs';
import {describePeriod} from './tui.mjs';
import {readPlanUsage} from './plan-usage.mjs';

export function snapshot(argv=[], {now=Date.now(),home=os.homedir(),roots=projectRoots()}={}) {
  const periodIndex=argv.indexOf('--period');
  const period=periodIndex>=0 ? argv[periodIndex+1] : 'all';
  const settingsPath=path.join(home,'.claude-usage-explorer','settings.json');
  let settings={};
  try {settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));}catch{}
  const rates={...DEFAULT_RATES,...settings.rates};
  const window=timeWindow(period,now,settings.billingDay,settings.billingTimeZone||'UTC',settings.billingHour||0,settings.billingMinute||0);
  const report=summarize(ingest(roots,rates),window,rates);
  return {period,periodLabel:describePeriod(period,settings,now),settings:{billingDay:settings.billingDay||null,billingTimeZone:settings.billingTimeZone||'UTC'},updatedAt:now,report,planUsage:readPlanUsage({now})};
}

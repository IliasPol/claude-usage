import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialSpend,usageBar} from '../hooks/usage-explorer.mjs';
test('official spend normalizes minor currency units',()=>{
 const value=parseOfficialSpend({spend:{used:{amount_minor:7532,currency:'USD',exponent:2},limit:{amount_minor:20000,currency:'USD',exponent:2},percent:37.66}});
 assert.deepEqual(value,{used:75.32,limit:200,currency:'USD',percent:37.66,source:'spend'});
});
test('extra usage fallback and no double counting',()=>{
 const value=parseOfficialSpend({extra_usage:{used_credits:75.32,monthly_limit:200,currency:'USD',utilization:37.66}});
 assert.equal(value.used,75.32);assert.equal(value.limit,200);
});
test('mismatched currencies do not report official spend',()=>{
 assert.equal(parseOfficialSpend({spend:{used:{amount_minor:500,currency:'EUR',exponent:2},limit:{amount_minor:1000,currency:'USD',exponent:2}}}),null);
});
test('bar displays filled and empty segments',()=>{
 assert.match(usageBar(37.66,10),/^████░░░░░░  37\.7%$/);
});

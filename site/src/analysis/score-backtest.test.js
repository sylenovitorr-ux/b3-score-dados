import test from "node:test";
import assert from "node:assert/strict";
import { backtestScoreSnapshots } from "./score-backtest.js";
const prices=Array.from({length:8},(_,i)=>({date:`2026-01-0${i+1}`,close:100+i}));
test("backtest não aceita score sem snapshot datado",()=>assert.equal(backtestScoreSnapshots([] ,prices).available,false));
test("backtest usa preço futuro somente após snapshot",()=>{const r=backtestScoreSnapshots([{date:"2026-01-03",score:85,confidence:80}],prices,{horizonSessions:3});assert.equal(r.available,true);assert.equal(r.records[0].entry,102);assert.equal(r.records[0].exit,105)});

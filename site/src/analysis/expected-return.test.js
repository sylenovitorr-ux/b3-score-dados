import test from "node:test";
import assert from "node:assert/strict";
import { annualizedCdi, expectedTotalReturn } from "./expected-return.js";

test("CDI anualizado compõe uma série base 100 sem usar taxa inventada",()=>{const cdi=annualizedCdi({source:"BCB",series:[{date:"2026-01-01",base100:100},{date:"2026-01-02",base100:100.1},{date:"2026-01-03",base100:100.2}]},2);assert.equal(cdi.sessions,2);assert.ok(cdi.value>0)});
test("retorno total combina valorização e proventos na mesma janela",()=>{const asset={kind:"fii",price:80,fund:{navPerShare:100,dy12:12,scores:{quality:80,risk:75,confidence:85}}};const r=expectedTotalReturn(asset,{series:{CDI:{series:[{date:"2026-01-01",base100:100},{date:"2026-12-31",base100:113}],source:"BCB"}}});assert.equal(r.status,"estimated");assert.ok(r.appreciationPct>0);assert.equal(r.incomePct,12);assert.ok(r.totalPct>r.appreciationPct);assert.ok(r.premiumPct!=null)});
test("ausência de proventos não vira retorno total zero",()=>{const asset={kind:"stock",price:10,fundamentals:{eps:2,bookValuePerShare:8,roe:15,scores:{quality:70,debt:70,confidence:80}}};const r=expectedTotalReturn(asset);assert.equal(r.totalPct,null);assert.ok(r.missing.includes("proventos/rendimentos 12m"))});

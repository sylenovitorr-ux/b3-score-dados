import test from "node:test";
import assert from "node:assert/strict";
import { dividendSustainability } from "./dividend-sustainability.js";
test("não trata DY ausente como renda zero",()=>{const r=dividendSustainability({kind:"stock",fundamentals:{dividendRegularity:null,payout:null}});assert.equal(r.status,"insufficient_data");assert.ok(r.missing.includes("DY 12m"))});
test("alerta estatístico de provento fora da mediana não afirma causalidade",()=>{const r=dividendSustainability({kind:"stock",fundamentals:{dividendYield:8,dividendRegularity:50,payout:70,dividendEvents:[{valuePerShare:1},{valuePerShare:1.1},{valuePerShare:3}]}});assert.equal(r.status,"available");assert.match(r.extraordinary,/podem ser extraordinários/)});

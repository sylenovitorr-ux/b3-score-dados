import test from "node:test";
import assert from "node:assert/strict";
import { buildDecision } from "./decision-engine.js";

const profile={objective:"balanced",risk:"moderate"};
test("decisão fica indisponível sem elegibilidade fundamental",()=>{const asset={kind:"stock",ticker:"TEST3",price:10,changepct:8,volume:1e8,fundamentals:{scores:{price:null,quality:null,debt:null,dividends:null,confidence:90}}};const result=buildDecision(asset,profile);assert.equal(result.status,"unavailable");assert.equal(result.fitScore,0)});
test("banco elegível não depende de dívida industrial",()=>{const asset={kind:"stock",ticker:"BANK3",price:10,fundamentals:{financialCompany:true,referenceDate:"2026-08-01",scores:{price:70,quality:75,debt:null,dividends:65,confidence:90}}};const result=buildDecision(asset,profile);assert.notEqual(result.status,"unavailable")});

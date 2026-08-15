import test from "node:test";
import assert from "node:assert/strict";
import { importOptionMarket, marketSnapshotMap, snapshotAge } from "./option-market-import.js";

test("importa CSV auditável separado por ponto e vírgula", () => {
  const result = importOptionMarket("ticker;bid;ask;openInterest;referenceDate;source\nBBSEA420;1,20;1,25;1234;2026-08-14;Corretora X", "2026-08-15T00:00:00Z");
  assert.deepEqual(result.errors, []);
  assert.deepEqual({ ...result.rows[0], importedAt: undefined }, { ticker: "BBSEA420", bid: 1.2, ask: 1.25, openInterest: 1234, referenceDate: "2026-08-14", source: "Corretora X", importedAt: undefined });
  assert.equal(marketSnapshotMap(result.rows).BBSEA420.referenceDate, "2026-08-14");
});

test("rejeita book cruzado e open interest inválido", () => {
  const result = importOptionMarket("ticker,bid,ask,openInterest,referenceDate,source\nBBSEA420,2,1,-5,2026-08-14,Teste");
  assert.deepEqual(result.rows, []);
  assert.match(result.errors[0], /ask menor que bid/);
});

test("classifica defasagem da fotografia", () => {
  assert.equal(snapshotAge("2026-08-14", new Date("2026-08-15T12:00:00Z")).status, "ATUALIZADO");
  assert.equal(snapshotAge("2026-08-10", new Date("2026-08-15T12:00:00Z")).status, "MUITO DEFASADO");
});

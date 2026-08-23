import test from "node:test";
import assert from "node:assert/strict";
import { issuerKey, uniqueByIssuer } from "./issuer-key.js";

test("classes diferentes do mesmo emissor ocupam uma única vaga", () => {
  const rows = [
    { asset: { ticker: "BBDC3", name: "Banco Bradesco ON", fundamentals: { cnpj: "60.746.948/0001-12" } } },
    { asset: { ticker: "BBDC4", name: "Banco Bradesco PN", fundamentals: { cnpj: "60.746.948/0001-12" } } },
    { asset: { ticker: "PETR4", name: "Petrobras PN", fundamentals: { cnpj: "33.000.167/0001-01" } } },
  ];
  assert.equal(issuerKey(rows[0].asset), issuerKey(rows[1].asset));
  assert.deepEqual(uniqueByIssuer(rows).map((row) => row.asset.ticker), ["BBDC3", "PETR4"]);
});

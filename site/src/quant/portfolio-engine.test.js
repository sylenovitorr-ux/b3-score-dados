import test from "node:test";
import assert from "node:assert/strict";
import { calculatePortfolio, migratePortfolio } from "./portfolio-engine.js";

test("migração preserva posições legadas sem tocar no armazenamento antigo", () => {
  const migrated = migratePortfolio([{ ticker: "bbse3", quantity: 10, price: 20 }]);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.positions[0].ticker, "BBSE3");
  assert.equal(migrated.positions[0].averagePrice, 20);
});

test("posição sem cotação mantém valor atual indisponível", () => {
  const portfolio = calculatePortfolio([{ id: "1", ticker: "MISS3", quantity: 10, averagePrice: 5, brokerage: null }], [], {});
  assert.equal(portfolio.rows[0].currentValue, null);
  assert.equal(portfolio.coveragePct, 0);
});

test("carteira calcula P&L e concentração com cotações reais fornecidas", () => {
  const positions = [{ id: "1", ticker: "AAA3", quantity: 10, averagePrice: 8, brokerage: 0 }, { id: "2", ticker: "BBB3", quantity: 10, averagePrice: 10, brokerage: 0 }];
  const assets = [{ ticker: "AAA3", price: 10, kind: "stock", fundamentals: { sector: "A" } }, { ticker: "BBB3", price: 10, kind: "stock", fundamentals: { sector: "B" } }];
  const result = calculatePortfolio(positions, assets, {});
  assert.equal(result.currentValue, 200);
  assert.equal(result.pnl, 20);
  assert.equal(result.top3Pct, 100);
});

import test from "node:test";
import assert from "node:assert/strict";
import { freshness } from "./data-quality.js";

test("pregão recente é identificado como atualizado", () => {
  const result = freshness("2026-08-27", "price", new Date("2026-08-28T12:00:00Z"));
  assert.equal(result.code, "ATUALIZADO");
  assert.equal(result.ageDays, 1);
});

test("pregão antigo não é apresentado como atualizado", () => {
  const result = freshness("2026-08-14", "price", new Date("2026-08-28T12:00:00Z"));
  assert.equal(result.code, "MUITO_DEFASADO");
  assert.equal(result.ageDays, 14);
});

test("data ausente fica indisponível", () => {
  assert.equal(freshness(null, "price").code, "INDISPONIVEL");
});

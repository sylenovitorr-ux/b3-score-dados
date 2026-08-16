const cents = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
const money = (value) => value == null ? null : value / 100;
const nonNegative = (value) => value != null && value >= 0 ? value : null;

export const TAX_RULES = Object.freeze({
  stock_common: { assetType: "stock", operation: "common", rate: .15, irrfRate: .00005, exemptionMonthlySalesLimit: 20_000, source: "Receita Federal — Bolsa de Valores e Isenções", verifiedAt: "2026-08-15", validFrom: "2026-01-01" },
  stock_day_trade: { assetType: "stock", operation: "day_trade", rate: .20, irrfRate: .01, exemptionMonthlySalesLimit: null, source: "Receita Federal — Bolsa de Valores e Retenções", verifiedAt: "2026-08-15", validFrom: "2026-01-01" },
  fii_common: { assetType: "fii", operation: "common", rate: .20, irrfRate: .00005, exemptionMonthlySalesLimit: null, source: "Receita Federal — Fundos de Investimento no Brasil e Retenções", verifiedAt: "2026-08-15", validFrom: "2026-01-01" },
  fii_day_trade: { assetType: "fii", operation: "day_trade", rate: .20, irrfRate: .01, exemptionMonthlySalesLimit: null, source: "Receita Federal — Bolsa de Valores e Retenções", verifiedAt: "2026-08-15", validFrom: "2026-01-01" },
});

export function positionSizing({ capital, riskPct, entry, stop, maxPositionPct = null }) {
  const total = cents(capital), price = cents(entry), stopPrice = cents(stop), pct = Number(riskPct);
  if (!(total > 0) || !(price > 0) || !(stopPrice >= 0) || !(price > stopPrice) || !(pct > 0)) return { available: false, reason: "Informe capital, risco percentual, entrada e stop abaixo da entrada." };
  const riskBudget = Math.round(total * pct / 100), perShareRisk = price - stopPrice;
  let quantity = Math.floor(riskBudget / perShareRisk);
  if (maxPositionPct != null && Number(maxPositionPct) > 0) quantity = Math.min(quantity, Math.floor(total * Number(maxPositionPct) / 100 / price));
  const positionValue = quantity * price, estimatedLoss = quantity * perShareRisk;
  return { available: quantity > 0, capital: money(total), riskBudget: money(riskBudget), riskPerShare: money(perShareRisk), quantity, positionValue: money(positionValue), positionPct: positionValue / total * 100, estimatedLoss: money(estimatedLoss), formula: "quantidade = piso(risco monetário ÷ (entrada − stop)); o limite de posição, quando configurado, reduz a quantidade." };
}

export function simulateTrade({ assetType = "stock", operation = "common", quantity, buyPrice, sellPrice, brokerageBuy = 0, brokerageSell = 0, otherCosts = 0, b3FeesBuy = null, b3FeesSell = null, monthlySales = null, carriedLoss = 0 }) {
  const key = `${assetType}_${operation}`, rule = TAX_RULES[key];
  const qty = Number(quantity), buy = cents(buyPrice), sell = cents(sellPrice), brokerageBuyCents = nonNegative(cents(brokerageBuy)), brokerageSellCents = nonNegative(cents(brokerageSell)), otherCostsCents = nonNegative(cents(otherCosts));
  const feesBuy = b3FeesBuy == null ? null : nonNegative(cents(b3FeesBuy)), feesSell = b3FeesSell == null ? null : nonNegative(cents(b3FeesSell));
  if (!rule || !(qty > 0) || !(buy >= 0) || !(sell >= 0) || brokerageBuyCents == null || brokerageSellCents == null || otherCostsCents == null) return { available: false, reason: "Dados inválidos ou regra tributária indisponível." };
  const buyValue = Math.round(qty * buy), sellValue = Math.round(qty * sell);
  const costsKnown = feesBuy != null && feesSell != null;
  const totalCosts = costsKnown ? brokerageBuyCents + brokerageSellCents + otherCostsCents + feesBuy + feesSell : null;
  const netBeforeTax = totalCosts == null ? null : sellValue - buyValue - totalCosts;
  const lossOffset = Math.max(0, cents(carriedLoss) ?? 0);
  const monthly = monthlySales == null ? null : cents(monthlySales);
  const exemptionUndetermined = rule.exemptionMonthlySalesLimit != null && monthly == null;
  const exempt = rule.exemptionMonthlySalesLimit != null && monthly != null && monthly <= rule.exemptionMonthlySalesLimit;
  const taxableBase = netBeforeTax == null ? null : Math.max(0, netBeforeTax - lossOffset);
  const grossTax = taxableBase == null || exemptionUndetermined ? null : exempt ? 0 : Math.round(taxableBase * rule.rate);
  const irrf = netBeforeTax == null || netBeforeTax <= 0 ? 0 : operation === "day_trade" ? Math.round(netBeforeTax * rule.irrfRate) : Math.round(sellValue * rule.irrfRate);
  const remainingTax = grossTax == null ? null : Math.max(0, grossTax - irrf);
  return {
    available: true, rule, values: { buy: money(buyValue), sell: money(sellValue), brokerageBuy: money(brokerageBuyCents), brokerageSell: money(brokerageSellCents), otherCosts: money(otherCostsCents), b3FeesBuy: money(feesBuy), b3FeesSell: money(feesSell), grossResult: money(sellValue - buyValue), netBeforeTax: money(netBeforeTax), taxableBase: money(taxableBase), irrf: money(irrf), grossTax: money(grossTax), taxRemaining: money(remainingTax), netFinal: remainingTax == null || netBeforeTax == null ? null : money(netBeforeTax - remainingTax) },
    status: { b3Fees: costsKnown ? "informadas" : "Dado indisponível", exemption: exemptionUndetermined ? "Dados insuficientes para determinar a isenção mensal de ações." : exempt ? "isenta pela informação mensal fornecida" : "tributável" },
    formula: "resultado líquido antes do IR = venda − compra − taxas B3 − corretagem − outros custos; IR restante = IR apurado − IRRF compensável.",
    limitation: costsKnown ? (exemptionUndetermined ? "Informe o total de vendas de ações no mês para concluir a isenção." : "Apuração mensal completa ainda pode depender de outras operações e prejuízos segregados.") : "Informe as taxas B3 efetivamente cobradas ou a tabela oficial aplicável; elas não foram assumidas como zero.",
  };
}

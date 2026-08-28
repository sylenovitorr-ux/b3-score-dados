import { lotSizeFor, maxQuantityFor } from "./battle-market.js";

const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function validatePortfolioPurchase({ asset, marketMode, quantity, entryPrice, entryDate, stop, target, strategy, remainingCapital }) {
  const price = finite(entryPrice);
  const qty = finite(quantity);
  const stopPrice = finite(stop);
  const targetPrice = finite(target);
  const lotSize = asset ? lotSizeFor(asset, marketMode) : 1;
  const maximum = asset ? maxQuantityFor(asset, marketMode) : null;
  const errors = [];
  if (!asset?.ticker) errors.push("Escolha um ativo da lista.");
  if (!(price > 0)) errors.push("Informe um preço de entrada válido.");
  if (!(qty > 0) || !Number.isInteger(qty)) errors.push("Informe uma quantidade inteira maior que zero.");
  if (qty > 0 && Number.isInteger(qty) && qty % lotSize !== 0) errors.push(`A quantidade precisa respeitar o lote de ${lotSize}.`);
  if (maximum != null && qty > maximum) errors.push(`O fracionário aceita no máximo ${maximum} unidades.`);
  if (!entryDate) errors.push("Informe a data da compra.");
  if (strategy === "swing") {
    if (!(stopPrice > 0 && price > 0 && stopPrice < price)) errors.push("No Swing Trade, o stop deve ficar abaixo da entrada.");
    if (!(targetPrice > 0 && price > 0 && targetPrice > price)) errors.push("No Swing Trade, o alvo deve ficar acima da entrada.");
  }
  const total = price > 0 && qty > 0 ? price * qty : null;
  if (total != null && finite(remainingCapital) != null && total > finite(remainingCapital) + .005) errors.push("O valor da compra ultrapassa o orçamento disponível.");
  return { valid: errors.length === 0, errors, total, lotSize, maximum, price, quantity: qty, stop: stopPrice, target: targetPrice };
}

export function mergePurchaseHolding(existing, purchase) {
  if (!existing) return purchase;
  const previousQuantity = finite(existing.quantity) ?? 0;
  const addedQuantity = finite(purchase.quantity) ?? 0;
  const quantity = previousQuantity + addedQuantity;
  const previousCost = previousQuantity * (finite(existing.entryPrice) ?? 0);
  const addedCost = addedQuantity * (finite(purchase.entryPrice) ?? 0);
  return {
    ...existing,
    ...purchase,
    quantity,
    entryPrice: quantity > 0 ? (previousCost + addedCost) / quantity : purchase.entryPrice,
    entryDate: [existing.entryDate, purchase.entryDate].filter(Boolean).sort()[0] ?? purchase.entryDate,
    operations: [...(existing.operations ?? []), ...(purchase.operations ?? [])],
    thesis: existing.thesis ?? purchase.thesis ?? "",
    invalidation: existing.invalidation ?? purchase.invalidation ?? "",
  };
}

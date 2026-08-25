import { expectedOfficialQuoteDate, tradingSessionsBetween } from "../market-calendar.js";

const latest = (values) => values.filter(Boolean).map(String).sort().at(-1) ?? null;

export function marketDataHealth(assets = [], anomalies = null, now = new Date()) {
  const officialQuoteDate = latest(assets.map((asset) => asset.officialQuoteDate ?? (!asset.intraday ? asset.date : null)));
  const historyDate = anomalies?.quoteDate ?? latest(Object.values(anomalies?.assets ?? {}).map((row) => row?.lastDate));
  const expectedDate = expectedOfficialQuoteDate(now);
  const quoteLag = officialQuoteDate ? tradingSessionsBetween(officialQuoteDate, expectedDate) : null;
  const historyLag = historyDate ? tradingSessionsBetween(historyDate, expectedDate) : null;
  const covered = Object.values(anomalies?.assets ?? {}).filter((row) => Array.isArray(row?.series) && row.series.length >= 30).length;
  const quoteReady = quoteLag != null && quoteLag <= 1;
  const historyReady = historyLag != null && historyLag <= 1;
  const ready = quoteReady && historyReady && covered > 0;
  const reason = !officialQuoteDate ? "Cotação oficial indisponível."
    : !quoteReady ? `Cotação oficial defasada em ${quoteLag} pregões.`
      : !historyDate ? "Histórico diário indisponível."
        : !historyReady ? `Histórico diário defasado em ${historyLag} pregões.`
          : !covered ? "Nenhum ativo tem histórico suficiente para o duelo."
            : "Dados oficiais aptos para iniciar.";
  return { ready, officialQuoteDate, historyDate, expectedDate, quoteLag, historyLag, covered, universe: assets.length, reason };
}

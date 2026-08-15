import { clamp, finite, mean, stdev } from "./statistics.js";

const POSITIVE = ["alta", "lucro", "cresce", "recorde", "supera", "dividendo", "aprova", "expansão", "melhora", "reduz dívida"];
const NEGATIVE = ["queda", "prejuízo", "recua", "dívida", "investigação", "fraude", "crise", "perda", "rebaixa", "piora", "inadimplência"];
const MACRO = ["selic", "cdi", "ipca", "inflação", "dólar", "câmbio", "fed", "juros", "ibovespa", "atividade econômica"];
const SECTOR_TERMS = {
  banco: ["crédito", "inadimplência", "spread bancário", "banco central", "selic"],
  financeiro: ["crédito", "inadimplência", "seguro", "sinistro", "selic"],
  petróleo: ["brent", "opep", "petróleo", "combustível", "refino"],
  mineração: ["minério", "china", "siderurgia", "commodity", "produção mineral"],
  energia: ["energia", "aneel", "tarifa", "reservatório", "transmissão"],
  varejo: ["varejo", "consumo", "inflação", "crédito", "renda"],
  imobiliário: ["imóvel", "aluguel", "vacância", "igp-m", "juros"],
};

const text = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(text(needle)));
const validRows = (series = []) => series.filter((row) => finite(row?.close) !== null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const normalizedDate = (value) => {
  if (!value) return null;
  const raw = String(value);
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : raw.slice(0, 10);
};

export function periodReturn(series = [], sessions = 1) {
  const rows = validRows(series);
  if (rows.length <= sessions || rows.at(-1 - sessions).close <= 0) return null;
  return (rows.at(-1).close / rows.at(-1 - sessions).close - 1) * 100;
}

export function detectMovement(anomaly = null, benchmarkSeries = null) {
  const series = validRows(anomaly?.series ?? []);
  const returns = series.slice(1).map((row, index) => row.close / series[index].close - 1);
  const return1 = periodReturn(series, 1);
  const return5 = periodReturn(series, 5);
  const return20 = periodReturn(series, 20);
  const volatility = returns.length >= 20 ? stdev(returns.slice(-60)) * Math.sqrt(252) * 100 : null;
  const volumes = series.map((row) => finite(row.volume)).filter((value) => value !== null);
  const average20 = volumes.length >= 20 ? mean(volumes.slice(-20, -1)) : null;
  const volumeRatioPct = average20 > 0 && finite(series.at(-1)?.volume) !== null ? (series.at(-1).volume / average20 - 1) * 100 : null;
  const previous5 = series.length > 10 ? (series.at(-6).close / series.at(-11).close - 1) * 100 : null;
  const accelerationPct = return5 !== null && previous5 !== null ? return5 - previous5 : null;
  const benchmark5 = benchmarkSeries ? periodReturn(benchmarkSeries, 5) : null;
  const relative5 = return5 !== null && benchmark5 !== null ? return5 - benchmark5 : null;
  const gapPct = series.length >= 2 && finite(series.at(-1).open) !== null && series.at(-2).close > 0 ? (series.at(-1).open / series.at(-2).close - 1) * 100 : null;
  const relevant = Math.abs(anomaly?.returnZ ?? 0) >= 2.5 || (volumeRatioPct ?? 0) >= 80 || Math.abs(relative5 ?? 0) >= 5 || Math.abs(gapPct ?? 0) >= 4;
  return {
    return1Pct: return1, return5Pct: return5, return20Pct: return20,
    annualizedVolatilityPct: finite(anomaly?.annualizedVolatilityPct) ?? volatility,
    volumeVsAverage20Pct: volumeRatioPct, accelerationPct, gapPct,
    benchmarkReturn5Pct: benchmark5, relativeToBenchmark5Pct: relative5,
    high20: series.length ? Math.max(...series.slice(-20).map((row) => row.close)) : null,
    low20: series.length ? Math.min(...series.slice(-20).map((row) => row.close)) : null,
    classification: relevant ? "Movimento específico relevante detectado" : "Oscilação compatível com a janela observada",
    relevant,
    limitations: [benchmark5 === null ? "IBOV sincronizado indisponível para comparação relativa." : null, gapPct === null ? "Abertura histórica indisponível para medir gaps." : null].filter(Boolean),
  };
}

function sectorVocabulary(asset) {
  const sector = text(asset?.fundamentals?.sector ?? asset?.fund?.segment ?? "");
  return Object.entries(SECTOR_TERMS).flatMap(([key, terms]) => sector.includes(key) ? terms : []);
}

function sourceCredibility(source) {
  const value = text(source);
  if (containsAny(value, ["b3", "cvm", "banco central", "gov.br", "ri "])) return 100;
  if (containsAny(value, ["valor", "infomoney", "estadao", "folha", "reuters", "bloomberg", "exame"])) return 78;
  return source ? 55 : 25;
}

export function classifyEvidence(raw, asset, now = new Date()) {
  const title = text(raw?.title ?? raw?.event ?? "");
  const ticker = text(asset?.ticker);
  const company = text(asset?.fundamentals?.companyName ?? asset?.name);
  const direct = Boolean((ticker && title.includes(ticker)) || (company.length >= 5 && title.includes(company.slice(0, 18))));
  const sector = containsAny(title, sectorVocabulary(asset));
  const macro = containsAny(title, MACRO);
  const published = normalizedDate(raw?.seenDate ?? raw?.date);
  const ageDays = published && Number.isFinite(Date.parse(published)) ? Math.max(0, (now.getTime() - Date.parse(published)) / 86_400_000) : null;
  const temporal = ageDays === null ? 25 : ageDays <= 3 ? 100 : ageDays <= 10 ? 75 : ageDays <= 30 ? 45 : 15;
  const credibility = sourceCredibility(raw?.domain ?? raw?.source);
  const magnitude = containsAny(title, [...POSITIVE, ...NEGATIVE]) ? 85 : 40;
  const relation = direct ? 100 : sector ? 72 : macro ? 48 : 15;
  const relevance = Math.round(clamp(relation * .5 + temporal * .18 + credibility * .2 + magnitude * .12));
  const positive = POSITIVE.filter((word) => title.includes(text(word))).length;
  const negative = NEGATIVE.filter((word) => title.includes(text(word))).length;
  const sentiment = positive > negative ? "positivo" : negative > positive ? "negativo" : "neutro";
  return {
    ...raw, date: published, relevance, sentiment, relation: direct ? "empresa" : sector ? "setor" : macro ? "macroeconomia" : "indireta",
    credibility, temporalCompatibility: temporal,
    causality: "Associação temporal plausível; causalidade não comprovada.",
  };
}

function returnAfter(series, date, sessions) {
  const rows = validRows(series);
  const index = rows.findIndex((row) => String(row.date) >= String(date));
  if (index < 0 || index + sessions >= rows.length || rows[index].close <= 0) return null;
  return (rows[index + sessions].close / rows[index].close - 1) * 100;
}

export function normalizeEvents(asset, anomaly = null, radarRow = null, now = new Date()) {
  const series = anomaly?.series ?? [];
  const dividends = (asset?.fundamentals?.dividendEvents ?? []).map((item) => ({
    date: normalizedDate(item.approvedAt ?? item.lastDateWith ?? item.paymentDate),
    title: `${item.type ?? "Provento"} de ${item.valuePerShare == null ? "valor indisponível" : `R$ ${Number(item.valuePerShare).toFixed(4)}`} por ação`,
    category: "dividend", source: item.source ?? "B3",
    url: "https://sistemaswebb3-listados.b3.com.br/dividensOtherCorpActPage/?language=pt-br",
    relation: "empresa", relevance: 100, sentiment: "neutro", credibility: 100,
    causality: "Evento corporativo oficial; seu efeito sobre o preço não é presumido.",
  }));
  const news = (radarRow?.headlines ?? []).map((item) => classifyEvidence({ ...item, date: item.seenDate, source: item.domain, category: "news" }, asset, now));
  const anomalyEvent = anomaly?.score >= 20 ? [{
    date: anomaly.lastDate, title: anomaly.classification?.label ?? "Movimento estatístico relevante", category: "anomaly",
    source: "B3 COTAHIST", url: null, relation: "quantitativa", relevance: Math.min(100, 45 + anomaly.score / 2), sentiment: "neutro",
    credibility: 100, causality: "Sinal estatístico; não comprova fraude, manipulação ou causa do movimento.",
  }] : [];
  return [...dividends, ...news, ...anomalyEvent].filter((item) => item.date).map((item) => ({
    ...item,
    returnAfter1Pct: returnAfter(series, item.date, 1),
    returnAfter5Pct: returnAfter(series, item.date, 5),
    returnAfter20Pct: returnAfter(series, item.date, 20),
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function marketContextScore(events = []) {
  const relevant = events.filter((item) => item.category === "news" && item.relevance >= 35);
  if (!relevant.length) return { score: null, confidence: 0, coverage: 0, limitation: "Nenhum contexto noticioso suficientemente relevante disponível." };
  const signed = relevant.map((item) => item.sentiment === "positivo" ? item.relevance : item.sentiment === "negativo" ? -item.relevance : 0);
  const weighted = mean(signed) ?? 0;
  return { score: Math.round(clamp(50 + weighted * .45)), confidence: Math.round(clamp(mean(relevant.map((item) => item.credibility)) * Math.min(1, relevant.length / 4))), coverage: relevant.length, limitation: "O score resume contexto e relevância; não mede causalidade nem prevê retorno." };
}

export function explainPrice(asset, analysis, events = []) {
  const fair = finite(analysis?.levels?.fair);
  const price = finite(asset?.price);
  const gapPct = fair && price ? (price / fair - 1) * 100 : null;
  const f = asset?.fundamentals;
  const positives = [];
  const negatives = [];
  if ((f?.scores?.quality ?? 0) >= 70) positives.push("qualidade fundamental acima de 70/100");
  if ((f?.roe ?? 0) >= 15) positives.push(`ROE de ${f.roe.toFixed(1)}%`);
  if ((f?.netDebtEbitda ?? Infinity) <= 2) positives.push("endividamento operacional controlado na métrica disponível");
  if ((analysis?.components?.momentum?.value ?? 50) < 42) negatives.push("momentum recente enfraquecido");
  if ((analysis?.components?.risk?.value ?? 100) < 48) negatives.push("risco quantitativo elevado na janela observada");
  for (const event of events.filter((item) => item.relevance >= 65).slice(0, 4)) {
    const label = `${event.title} (${event.source ?? "fonte não informada"})`;
    if (event.sentiment === "positivo") positives.push(label);
    if (event.sentiment === "negativo") negatives.push(label);
  }
  const absoluteGap = gapPct === null ? null : Math.abs(gapPct);
  const state = absoluteGap === null ? { label: "Dados insuficientes", tone: "unavailable" }
    : absoluteGap <= 10 ? { label: "Bem explicado pelos fundamentos e contexto", tone: "explained" }
      : absoluteGap <= 25 ? { label: "Parcialmente explicado", tone: "partial" }
        : absoluteGap <= 45 ? { label: "Divergência relevante", tone: "divergent" }
          : { label: "Grande divergência entre preço, fundamentos e contexto", tone: "critical" };
  const explanation = gapPct === null ? "Dados insuficientes para comparar preço e valor fundamental."
    : gapPct < 0 ? "O preço está abaixo do consenso dos modelos válidos. Fatores de risco e contexto podem ajudar a explicar parte do desconto, sem provar a causa do movimento."
      : "O preço está acima do consenso dos modelos válidos. Qualidade, crescimento ou expectativas podem sustentar parte do prêmio, mas a divergência exige acompanhamento.";
  return { currentPrice: price, fairValue: fair, gapPct, state, positives, negatives, explanation };
}

export function scenarioBands(analysis) {
  const rows = analysis?.valuation?.scenarios ?? [];
  const volatility = finite(analysis?.risk?.volatility60Pct ?? analysis?.risk?.volatility20Pct);
  const uncertainty = clamp((volatility ?? 20) / 100, .08, .45);
  return rows.map((row, index) => {
    const factor = index === 1 ? uncertainty * .55 : uncertainty;
    return { ...row, low: row.value == null ? null : row.value * (1 - factor), high: row.value == null ? null : row.value * (1 + factor), uncertaintyPct: factor * 100 };
  });
}

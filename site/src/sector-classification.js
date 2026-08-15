// Camada complementar: nunca substitui a classificação oficial da B3/CVM.
// Só é usada para formar pares quando a inferência tem regra explícita e confiança alta.
const RULES = [
  ["Instituições financeiras", /\b(BANCO|BANK|CREDITO|CRÉDITO|FINANCEIRA|FINANCIAL|PAGAMENT|PAYMENT|SEGUROS|SEGURIDADE|PREVID|ASSET MANAGEMENT)\b/i],
  ["Energia elétrica", /\b(ENERGIA|ENERGY|ELETRICA|ELÉTRICA|GERACAO|GERAÇÃO|TRANSMISS|DISTRIBUI[CÇ][AÃ]O)\b/i],
  ["Petróleo, gás e combustíveis", /\b(PETRO|PETRÓLEO|OIL|GAS|GÁS|COMBUST[IÍ]VEIS|REFINARIA)\b/i],
  ["Mineração e siderurgia", /\b(MINER|VALE\b|SIDER|A[CÇ]O|STEEL|METALURG)\b/i],
  ["Saúde", /\b(SA[ÚU]DE|HOSPITAL|MEDIC|ODONTO|DIAGNOST|FARMA)\b/i],
  ["Varejo e consumo", /\b(VAREJO|LOJAS|RETAIL|MODA|ALIMENT|SUPERMERC|SHOPPING|CONSUMO)\b/i],
  ["Telecomunicações e tecnologia", /\b(TELECOM|TELEFON|TECH|TECNOLOG|SOFTWARE|DADOS)\b/i],
  ["Construção e imóveis", /\b(CONSTR|ENGENH|IMOB|REALTY|INCORPOR)\b/i],
  ["Transportes e logística", /\b(LOG[IÍ]ST|TRANSPORT|AERO|PORTO|FERROVIA|RODOVIA)\b/i],
  ["Papel, celulose e embalagens", /\b(PAPEL|CELULOSE|EMBALAG)\b/i],
];

export function classifySector(asset) {
  const f = asset?.fundamentals ?? asset?.fund ?? {};
  // Em ações, "segment" no snapshot é segmento de listagem (Novo Mercado,
  // Nível 2 etc.) e nunca deve entrar como setor econômico. Em FIIs, o
  // segmento do informe é a classificação operacional disponível.
  const official = asset?.kind === "fii" ? (f.segment ?? f.sector) : f.sector;
  if (official) return { label: official, source: "Classificação publicada pela fonte", confidence: "alta", official: true };
  const text = `${asset?.ticker ?? ""} ${asset?.name ?? ""} ${f.companyName ?? ""}`;
  const match = RULES.find(([, pattern]) => pattern.test(text));
  return match ? { label: match[0], source: "Classificação inferida por regra de nome/atividade", confidence: "alta", official: false } : { label: null, source: "Sem evidência suficiente para classificar", confidence: "baixa", official: false };
}

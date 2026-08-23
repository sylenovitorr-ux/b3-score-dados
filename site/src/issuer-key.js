const clean = (value) => String(value ?? "").replace(/\D/g, "");

export function issuerKey(asset) {
  const data = asset?.kind === "fii" ? asset?.fund : asset?.fundamentals;
  const cnpj = clean(data?.cnpj);
  if (cnpj) return `cnpj:${cnpj}`;
  if (data?.cvmCode != null && data.cvmCode !== "") return `cvm:${data.cvmCode}`;
  const name = String(asset?.name ?? "")
    .toUpperCase()
    .replace(/\b(ON|PN|PNA|PNB|UNIT|UNT|N1|N2|NM|EDJ|EJ|EX)\b/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return name ? `name:${name}` : `ticker:${asset?.ticker ?? "N/D"}`;
}

export function uniqueByIssuer(rows, assetFromRow = (row) => row?.asset) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = issuerKey(assetFromRow(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

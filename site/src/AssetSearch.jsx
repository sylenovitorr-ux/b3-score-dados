import { useMemo, useState } from "react";
import { assetKindLabel, marketSymbol, matchesAssetSearch } from "./battle-market.js";
import { formatMoney } from "./formatters.js";
import "./AssetSearch.css";

export default function AssetSearch({
  assets = [],
  excludeTickers = [],
  onSelect,
  label = "Buscar ativo",
  placeholder = "Digite o código ou nome",
  fractionalSymbols = false,
  limit = 8,
}) {
  const [query, setQuery] = useState("");
  const excluded = useMemo(() => new Set(excludeTickers), [excludeTickers]);
  const matches = useMemo(() => query.trim()
    ? assets.filter((asset) => !excluded.has(asset.ticker) && matchesAssetSearch(asset, query, fractionalSymbols ? "fractional" : "standard")).slice(0, limit)
    : [], [assets, excluded, fractionalSymbols, limit, query]);

  const choose = (asset) => {
    onSelect?.(asset);
    setQuery("");
  };

  return <label className="asset-search-field">{label}<div className="asset-search-wrap">
    <input value={query} onChange={(event) => setQuery(event.target.value.toUpperCase())} placeholder={placeholder} autoComplete="off" />
    {query && <div className="asset-search-options" role="listbox">
      {matches.map((asset) => <button type="button" role="option" key={asset.ticker} onClick={() => choose(asset)}>
        <b>{marketSymbol(asset, fractionalSymbols ? "fractional" : "standard")}</b><span>{asset.name}</span><em>{assetKindLabel(asset)} · {formatMoney(asset.price)}</em>
      </button>)}
      {!matches.length && <span className="asset-search-empty">Nenhum ativo encontrado.</span>}
    </div>}
  </div></label>;
}

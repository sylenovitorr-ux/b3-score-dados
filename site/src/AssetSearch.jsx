import { useMemo, useState } from "react";
import { assetKindLabel, marketSymbol, marketVariants, matchesAssetSearch } from "./battle-market.js";
import { formatMoney } from "./formatters.js";
import "./AssetSearch.css";

export default function AssetSearch({
  assets = [],
  excludeTickers = [],
  onSelect,
  label = "Buscar ativo",
  placeholder = "Digite o código ou nome",
  fractionalSymbols = false,
  marketOptions = false,
  limit = 8,
}) {
  const [query, setQuery] = useState("");
  const excluded = useMemo(() => new Set(excludeTickers), [excludeTickers]);
  const matches = useMemo(() => query.trim()
    ? assets.flatMap((asset) => {
      if (excluded.has(asset.ticker)) return [];
      const variants = marketOptions ? marketVariants(asset) : [{ marketMode: fractionalSymbols ? "fractional" : "standard", displayTicker: marketSymbol(asset, fractionalSymbols ? "fractional" : "standard"), label: assetKindLabel(asset) }];
      return variants.filter((variant) => matchesAssetSearch(asset, query, variant.marketMode)).map((variant) => ({ asset, ...variant }));
    }).slice(0, limit)
    : [], [assets, excluded, fractionalSymbols, limit, marketOptions, query]);

  const choose = (option) => {
    onSelect?.(option.asset, option);
    setQuery("");
  };

  return <label className="asset-search-field">{label}<div className="asset-search-wrap">
    <input value={query} onChange={(event) => setQuery(event.target.value.toUpperCase())} placeholder={placeholder} autoComplete="off" />
    {query && <div className="asset-search-options" role="listbox">
      {matches.map((option) => <button type="button" role="option" aria-selected="false" key={`${option.asset.ticker}-${option.marketMode}`} onClick={() => choose(option)}>
        <b>{option.displayTicker}</b><span>{option.asset.name}</span><em>{option.label} · {formatMoney(option.asset.price)}</em>
      </button>)}
      {!matches.length && <span className="asset-search-empty">Nenhum ativo encontrado.</span>}
    </div>}
  </div></label>;
}

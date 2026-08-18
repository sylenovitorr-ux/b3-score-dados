import { useMemo } from "react";
import AssetIntelligencePanelCore from "./AssetIntelligencePanelCore.jsx";
import TradeSignalPanel from "./TradeSignalPanel.jsx";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import "./trade-signal.css";

export default function AssetIntelligencePanel(props) {
  const { asset, assets, anomaly } = props;
  const analysis = useMemo(() => buildQuantAnalysis(asset, assets, anomaly), [asset, assets, anomaly]);
  const book = asset?.book ?? null;

  return <>
    <TradeSignalPanel asset={asset} analysis={analysis} book={book} />
    <AssetIntelligencePanelCore {...props} />
  </>;
}

import { useMemo } from "react";
import AssetIntelligencePanelCore from "./AssetIntelligencePanelCore.jsx";
import AssetSummaryPanel from "./AssetSummaryPanel.jsx";
import TradeSignalPanel from "./TradeSignalPanel.jsx";
import DailyHistoryPanel from "./DailyHistoryPanel.jsx";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import "./trade-signal.css";
import "./theme-premium.css";
import "./usability-v3.css";
import "./ux-platform.css";

export default function AssetIntelligencePanel(props) {
  const { asset, assets, anomaly } = props;
  const analysis = useMemo(() => buildQuantAnalysis(asset, assets, anomaly), [asset, assets, anomaly]);
  const book = asset?.book ?? null;

  return <>
    <AssetSummaryPanel asset={asset} />
    <TradeSignalPanel asset={asset} analysis={analysis} book={book} />
    <DailyHistoryPanel series={anomaly?.series ?? []} ticker={asset.ticker} />
    <AssetIntelligencePanelCore {...props} />
  </>;
}

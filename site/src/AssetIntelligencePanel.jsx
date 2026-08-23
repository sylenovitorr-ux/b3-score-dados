import { useMemo } from "react";
import AssetSummaryPanel from "./AssetSummaryPanel.jsx";
import AssetAnalysisTabs from "./AssetAnalysisTabs.jsx";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import "./trade-signal.css";
import "./theme-premium.css";
import "./usability-v3.css";
import "./ux-platform.css";
import "./asset-tabs.css";

const STRATEGY_KEY = "b3-score-radar-strategy-v1";

export default function AssetIntelligencePanel(props) {
  const { asset, assets, anomaly } = props;
  const strategy = typeof localStorage === "undefined" ? "swing" : localStorage.getItem(STRATEGY_KEY) || "swing";
  const analysis = useMemo(() => buildQuantAnalysis(asset, assets, anomaly, strategy === "swing" ? "swing_3_6m" : "long_term"), [asset, assets, anomaly, strategy]);
  return <>
    <AssetSummaryPanel asset={asset} analysis={analysis} />
    <AssetAnalysisTabs asset={asset} analysis={analysis} anomaly={anomaly} coreProps={props} strategy={strategy} />
  </>;
}

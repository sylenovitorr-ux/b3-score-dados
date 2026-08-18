import { useMemo } from "react";
import AssetSummaryPanel from "./AssetSummaryPanel.jsx";
import AssetAnalysisTabs from "./AssetAnalysisTabs.jsx";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import "./trade-signal.css";
import "./theme-premium.css";
import "./usability-v3.css";
import "./ux-platform.css";
import "./asset-tabs.css";

export default function AssetIntelligencePanel(props) {
  const { asset, assets, anomaly } = props;
  const analysis = useMemo(() => buildQuantAnalysis(asset, assets, anomaly), [asset, assets, anomaly]);
  return <>
    <AssetSummaryPanel asset={asset} />
    <AssetAnalysisTabs asset={asset} analysis={analysis} anomaly={anomaly} coreProps={props} />
  </>;
}

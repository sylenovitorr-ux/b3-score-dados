import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("market_anomalies", Path(__file__).with_name("build-market-anomalies.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MarketAnomalyTest(unittest.TestCase):
    def rows(self, returns, volumes=None):
        price = 10
        result = [{"date": "2026-01-01", "open": price, "high": price * 1.01, "low": price * .99, "close": price, "volume": 1_000_000}]
        for index, change in enumerate(returns, 2):
            price *= 1 + change / 100
            result.append({"date": f"2026-01-{index:02d}", "open": price, "high": price * 1.01, "low": price * .99, "close": price, "volume": (volumes or [1_000_000] * len(returns))[index - 2]})
        return result

    def test_stable_series_is_not_called_fraud(self):
        result = MODULE.analyse("TEST3", self.rows([.2, -.1] * 35))
        self.assertLess(result["score"], 20)
        self.assertNotIn("fraude", str(result).lower())

    def test_price_and_volume_spike_are_flagged(self):
        changes = [.2, -.1] * 34 + [18]
        volumes = [1_000_000] * 68 + [30_000_000]
        result = MODULE.analyse("TEST3", self.rows(changes, volumes))
        codes = {flag["code"] for flag in result["flags"]}
        self.assertIn("return", codes)
        self.assertIn("volume", codes)
        self.assertGreaterEqual(result["score"], 40)

    def test_auditable_series_keeps_up_to_ten_year_sessions(self):
        rows = [{"date": f"D{index:04d}", "open": 10 + index * .01, "high": 10.1 + index * .01, "low": 9.9 + index * .01, "close": 10 + index * .01, "volume": 1_000_000} for index in range(2600)]
        result = MODULE.analyse("TEST3", rows)
        self.assertEqual(len(result["series"]), 2520)

    def test_movement_windows_and_volume_ratio_are_exposed(self):
        rows = self.rows([.2] * 39, [1_000_000] * 38 + [3_000_000])
        result = MODULE.analyse("TEST3", rows)
        self.assertIsNotNone(result["return5Pct"])
        self.assertIsNotNone(result["return20Pct"])
        self.assertGreater(result["volumeVsAverage20Pct"], 100)
        self.assertIn("open", result["series"][-1])


if __name__ == "__main__":
    unittest.main()

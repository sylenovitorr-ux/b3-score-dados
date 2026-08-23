import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("refresh-intraday-v2.py")
SPEC = importlib.util.spec_from_file_location("refresh_intraday_v2", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class IntradaySeriesTest(unittest.TestCase):
    def test_accumulates_current_market_day_only(self):
        previous = {"quotes": [{"ticker": "PETR4", "series": [
            {"asOf": "2026-08-20T14:00:00Z", "price": 29},
            {"asOf": "2026-08-21T14:00:00Z", "price": 30},
        ]}]}
        data = {"updatedAt": "2026-08-21T14:08:00Z", "quotes": [{"ticker": "PETR4", "price": 30.2, "volume": 1000, "asOf": "2026-08-21T14:08:00Z"}]}
        result = MODULE.merge_intraday_series(data, previous)
        self.assertEqual(len(result["quotes"][0]["series"]), 2)
        self.assertEqual(result["quotes"][0]["series"][-1]["price"], 30.2)

    def test_repeated_timestamp_is_replaced(self):
        previous = {"quotes": [{"ticker": "VALE3", "series": [{"asOf": "2026-08-21T14:00:00Z", "price": 50}]}]}
        data = {"quotes": [{"ticker": "VALE3", "price": 50.5, "asOf": "2026-08-21T14:00:00Z"}]}
        result = MODULE.merge_intraday_series(data, previous)
        self.assertEqual(result["quotes"][0]["series"], [{"asOf": "2026-08-21T14:00:00Z", "price": 50.5, "volume": None}])


if __name__ == "__main__":
    unittest.main()

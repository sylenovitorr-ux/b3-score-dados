import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("benchmarks", Path(__file__).with_name("build-benchmarks.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BenchmarkTest(unittest.TestCase):
    def test_normalizes_without_inventing_dates(self):
        rows = MODULE.normalized([{"date": "2026-01-02", "value": 120}, {"date": "2026-01-03", "value": 126}])
        self.assertEqual(rows, [{"date": "2026-01-02", "value": 120, "base100": 100}, {"date": "2026-01-03", "value": 126, "base100": 105}])

    def test_compounds_daily_cdi_factor(self):
        rows = MODULE.compound_daily_percent([{"date": "2026-01-02", "value": 1}, {"date": "2026-01-03", "value": 2}])
        self.assertEqual(rows[-1]["base100"], 103.02)

    def test_unavailable_is_explicit(self):
        row = MODULE.unavailable("IBOV", "Ibovespa", "B3", "sem série")
        self.assertEqual(row["status"], "INDISPONÍVEL")
        self.assertEqual(row["series"], [])

    def test_parses_b3_daily_ptbr_without_inventing_invalid_days(self):
        payload = {"results": [{"day": 1, "rateValue1": "100.123,45", "rateValue2": "101.000,00"}, {"day": 31, "rateValue2": "999,00"}]}
        rows = MODULE.parse_b3_daily(payload, 2026)
        self.assertEqual(rows, [{"date": "2026-01-01", "value": 100123.45}, {"date": "2026-02-01", "value": 101000.0}])


if __name__ == "__main__":
    unittest.main()

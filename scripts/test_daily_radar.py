import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("daily_radar", Path(__file__).with_name("build-daily-radar.py"))
radar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(radar)


class DailyRadarTest(unittest.TestCase):
    def test_headline_lexicon_stays_inside_scale(self):
        self.assertGreater(radar.headline_score("Lucro cresce e supera recorde"), 50)
        self.assertLess(radar.headline_score("Prejuízo, crise e rebaixamento"), 50)
        self.assertEqual(radar.headline_score("Empresa publica comunicado"), 50)

    def test_scenarios_are_bounded(self):
        asset = {
            "ticker": "TEST3", "name": "Teste", "price": 10, "date": "2026-08-12",
            "fundamentals": {"eps": 20, "bookValuePerShare": 100, "roe": 50, "revenueGrowth": 30},
        }
        base = {"asset": asset, "fundamental": 90, "technical": {"score": 90, "support": 9, "resistance": 12, "return20": 8, "return60": 12, "sessions": 80}, "confidence": 90, "liquidity": 90}
        news = {"score": 80, "coverage": 2, "headlines": []}
        strength = radar.finish(base, news, "strength")
        pressure = radar.finish(base, news, "pressure")
        self.assertLessEqual(strength["target"], asset["price"] * 1.40)
        self.assertGreaterEqual(pressure["target"], asset["price"] * .65)
        self.assertLess(strength["defensiveExit"], strength["entryLow"])


if __name__ == "__main__":
    unittest.main()

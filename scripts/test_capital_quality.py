import unittest

from capital_quality import normalize_capital_scale


class CapitalQualityTest(unittest.TestCase):
    def test_keeps_plausible_share_quantity(self):
        capital = {"ordinary": 800_000_000, "preferred": 0, "total": 800_000_000}
        result, audit = normalize_capital_scale(capital, 8_000_000_000, 1_000_000_000, 20)
        self.assertEqual(result, capital)
        self.assertEqual(audit["state"], "unchanged")

    def test_scales_quantity_in_thousands_using_earnings_evidence(self):
        capital = {"ordinary": 393_097, "preferred": 0, "total": 393_097}
        result, audit = normalize_capital_scale(capital, None, 1_896_000_000, 18.4)
        self.assertEqual(result["total"], 393_097_000)
        self.assertEqual(audit["multiplier"], 1000)
        self.assertTrue(any("LPA" in reason for reason in audit["reasons"]))

    def test_missing_quote_never_guesses_scale(self):
        capital = {"ordinary": 393_097, "preferred": 0, "total": 393_097}
        result, audit = normalize_capital_scale(capital, None, 1_896_000_000, None)
        self.assertEqual(result, capital)
        self.assertEqual(audit["state"], "unchanged")


if __name__ == "__main__":
    unittest.main()

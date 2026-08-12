#!/usr/bin/env python3
"""Regression tests for accounting classification and annual fallbacks."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from accounting_engine import is_financial_company, latest_annual_pair


class FinancialClassificationTests(unittest.TestCase):
    def test_bbse_is_financial(self):
        self.assertTrue(is_financial_company("BBSE", "BB Seguridade Participações S.A."))

    def test_industrial_company_is_not_financial(self):
        self.assertFalse(is_financial_company("WEGE", "WEG S.A."))


class AnnualFallbackTests(unittest.TestCase):
    def test_selects_latest_two_annual_statements(self):
        history = {
            "issuer": {
                "2024-12-31": {"3.11": 80},
                "2025-12-31": {"3.11": 100},
                "2023-12-31": {"3.11": 70},
            }
        }
        pair = latest_annual_pair(history, "issuer")
        self.assertEqual(pair["current"]["3.11"], 100)
        self.assertEqual(pair["previous"]["3.11"], 80)

    def test_missing_issuer_returns_empty_pair(self):
        self.assertEqual(
            latest_annual_pair({}, "missing"),
            {"current": {}, "previous": {}},
        )


if __name__ == "__main__":
    unittest.main()

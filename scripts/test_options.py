import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location("build_options", Path(__file__).with_name("build-options.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def record(ticker, market, name="BBSEGURIDADE", specification="ON", close=250, strike=3500, expiration="20261218", quantity=1500, trades=45, reference="20260813"):
    line = [" "] * 245
    def put(start, end, value): line[start:end] = str(value).ljust(end - start)[:end - start]
    def digits(start, end, value): line[start:end] = str(value).zfill(end - start)
    put(0, 2, "01"); put(2, 10, reference); put(10, 12, "02"); put(12, 24, ticker)
    put(24, 27, market); put(27, 39, name); put(39, 49, specification)
    digits(56, 69, close); digits(69, 82, close); digits(82, 95, close); digits(95, 108, close)
    digits(108, 121, close); digits(147, 152, trades); digits(152, 170, quantity); digits(170, 188, close * quantity)
    digits(188, 201, strike); put(202, 210, expiration); put(230, 242, "BRTESTACNOR1")
    return "".join(line)


class OptionsBuilderTest(unittest.TestCase):
    @staticmethod
    def write_session(folder, name, lines):
        path = Path(folder) / name
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(name.replace(".ZIP", ".TXT"), "\n".join(lines) + "\n")

    def test_parses_call_with_official_fields_and_preserves_missing_book(self):
        rows = MODULE.parse_options([record("BBSE3", "010"), record("BBSEA350", "070", specification="OPC")])
        self.assertEqual(len(rows), 1)
        option = rows[0]
        self.assertEqual(option["underlying"], "BBSE3")
        self.assertEqual(option["type"], "call")
        self.assertEqual(option["expiration"], "2026-12-18")
        self.assertEqual(option["strike"], 35)
        self.assertEqual(option["premium"], 2.5)
        self.assertIsNone(option["bid"])
        self.assertIsNone(option["openInterest"])

    def test_excludes_ambiguous_root_mapping(self):
        lines = [record("PETR3", "010", name="PETROBRAS"), record("PETR4", "010", name="PETROBRAS"), record("PETRA300", "070", name="PETROBRAS", specification="OPC")]
        self.assertEqual(MODULE.parse_options(lines), [])

    def test_invalid_expiration_is_not_invented(self):
        rows = MODULE.parse_options([record("BBSE3", "010"), record("BBSEA350", "070", specification="OPC", expiration="99991231")])
        self.assertEqual(rows, [])

    def test_uses_newest_session_that_actually_contains_options(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write_session(folder, "COTAHIST_D13082026.ZIP", [
                record("BBSE3", "010"),
                record("BBSEA350", "070", specification="OPC"),
            ])
            self.write_session(folder, "COTAHIST_D27082026.ZIP", [
                record("BBSE3", "010", reference="20260827"),
            ])
            with mock.patch.object(MODULE, "latest_selic", return_value={"valuePct": 13.9}):
                payload = MODULE.build(Path(folder))
        self.assertEqual(payload["status"], "ATUALIZADO")
        self.assertEqual(payload["quoteDate"], "2026-08-13")
        self.assertEqual(len(payload["contracts"]), 1)

    def test_missing_options_does_not_block_main_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write_session(folder, "COTAHIST_D27082026.ZIP", [
                record("BBSE3", "010", reference="20260827"),
            ])
            with mock.patch.object(MODULE, "latest_selic", return_value={"valuePct": 13.9}):
                payload = MODULE.build(Path(folder))
        self.assertEqual(payload["status"], "INDISPONIVEL")
        self.assertEqual(payload["quoteDate"], "2026-08-27")
        self.assertEqual(payload["contracts"], [])


if __name__ == "__main__":
    unittest.main()

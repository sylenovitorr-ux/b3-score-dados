import io
import tempfile
import unittest
import zipfile
from pathlib import Path

import b3_simplified


def zipped(xml: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("SPRE.xml", xml)
    return output.getvalue()


class SimplifiedReportTest(unittest.TestCase):
    def test_parse_and_materialize_official_simplified_report(self):
        payload = zipped("""<Document><PricRpt><TckrSymb>PETR4</TckrSymb><Dt>2026-08-24</Dt><FrstPric>31.1</FrstPric><MinPric>30.8</MinPric><MaxPric>32.0</MaxPric><TradAvrgPric>31.5</TradAvrgPric><LastPric>31.8</LastPric><RglrTxsQty>1200</RglrTxsQty><FinInstrmQty>500000</FinInstrmQty><NtlFinVol>15900000</NtlFinVol></PricRpt></Document>""")
        universe = {"PETR4": {"name": "Petrobras", "kind": "stock", "isin": "BRPETRACNPR6"}}
        sessions = b3_simplified.parse_report(payload, universe)
        self.assertEqual(sessions["2026-08-24"]["PETR4"]["close"], 31.8)
        with tempfile.TemporaryDirectory() as folder:
            target_folder = Path(folder)
            self.assertEqual(b3_simplified.materialize(payload, target_folder, universe), 1)
            target = target_folder / "COTAHIST_D24082026.ZIP"
            with zipfile.ZipFile(target) as archive:
                line = archive.read(archive.namelist()[0]).decode().splitlines()[0]
        self.assertEqual(len(line), 245)
        self.assertEqual(line[12:24].strip(), "PETR4")
        self.assertEqual(int(line[108:121]) / 100, 31.8)

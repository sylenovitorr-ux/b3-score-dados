#!/usr/bin/env python3
"""Refresh stocks, units, FIIs and fundamentals from official B3/CVM files."""

from __future__ import annotations

import json
import http.client
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def download(url: str, target: Path) -> bool:
    for
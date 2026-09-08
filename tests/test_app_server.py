"""Unit tests for app-server session + output APIs (no GPU)."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app-server"
sys.path.insert(0, str(APP_DIR))


class AppServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        base = Path(cls._tmpdir.name)
        # Import after env-less patch via module attributes
        import server as srv

        cls.srv = srv
        cls._orig = (srv.TEMP_DIR, srv.FTS_DIR, srv.OUTPUT_DIR, srv.ROOT)
        srv.TEMP_DIR = base / "temp"
        srv.FTS_DIR = base / "fts"
        srv.OUTPUT_DIR = base / "output"
        srv.ROOT = base
        srv.ensure_dirs()
        # Minimal index for / route optional — API tests only
        cls.client = TestClient(srv.app)

    @classmethod
    def tearDownClass(cls):
        cls.srv.TEMP_DIR, cls.srv.FTS_DIR, cls.srv.OUTPUT_DIR, cls.srv.ROOT = cls._orig
        cls._tmpdir.cleanup()

    def test_health(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_temp_roundtrip_and_delete(self):
        doc = {"format": "freetoshop", "version": 1, "width": 8, "height": 8, "layers": []}
        r = self.client.put("/api/temp/abc123", json=doc)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["id"], "abc123")
        got = self.client.get("/api/temp/abc123")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.json()["width"], 8)
        d = self.client.delete("/api/temp/abc123")
        self.assertTrue(d.json()["deleted"])
        self.assertEqual(self.client.get("/api/temp/abc123").status_code, 404)

    def test_fts_save_list_and_clears_temp(self):
        self.client.put(
            "/api/temp/draft1",
            json={"format": "freetoshop", "version": 1, "width": 4, "height": 4, "layers": []},
        )
        r = self.client.post(
            "/api/fts",
            json={
                "name": "My Comp",
                "tempId": "draft1",
                "document": {
                    "format": "freetoshop",
                    "version": 1,
                    "width": 4,
                    "height": 4,
                    "layers": [{"id": "layer-1", "name": "Background"}],
                },
            },
        )
        self.assertEqual(r.status_code, 200)
        sid = r.json()["id"]
        listing = self.client.get("/api/fts").json()
        self.assertTrue(any(s["id"] == sid for s in listing["sessions"]))
        self.assertEqual(self.client.get("/api/temp/draft1").status_code, 404)
        one = self.client.get(f"/api/fts/{sid}")
        self.assertEqual(one.json()["sessionName"], "My Comp")

    def test_output_png_archive(self):
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
            b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        r = self.client.post(
            "/api/output",
            files={"file": ("shot.png", png, "image/png")},
            data={"name": "shot"},
        )
        self.assertEqual(r.status_code, 200)
        name = r.json()["name"]
        self.assertTrue(name.endswith(".png"))
        self.assertTrue((self.srv.OUTPUT_DIR / name).is_file())
        listed = self.client.get("/api/output").json()["files"]
        self.assertTrue(any(f["name"] == name for f in listed))


if __name__ == "__main__":
    unittest.main()

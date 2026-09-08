import io
import os
import sys
import unittest
from pathlib import Path

os.environ["SAM_DEMO"] = "1"

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sam-server"))

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

import server


def _png(w=32, h=24):
    im = Image.new("RGB", (w, h), (236, 230, 216))
    px = im.load()
    for y in range(4, 16):
        for x in range(4, 14):
            px[x, y] = (196, 72, 64)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


class FloodMaskTests(unittest.TestCase):
    def test_selects_the_clicked_color_only(self):
        rgb = np.zeros((10, 12, 3), dtype=np.uint8)
        rgb[:] = (10, 10, 10)
        rgb[2:6, 3:8] = (200, 20, 20)
        mask = server.flood_mask(rgb, 5, 3, tolerance=10)
        self.assertEqual(int(mask[3, 5]), 255)
        self.assertEqual(int(mask[0, 0]), 0)

    def test_best_mask_picks_the_highest_score(self):
        masks = np.array([[[0, 1], [0, 0]], [[1, 1], [1, 1]]])
        scores = np.array([0.2, 0.9])
        chosen = server.best_mask(masks, scores)
        self.assertEqual(chosen.shape, (2, 2))
        self.assertEqual(int(chosen.max()), 255)

    def test_encode_mask_png_uses_alpha(self):
        mask = np.zeros((4, 4), dtype=np.uint8)
        mask[1:3, 1:3] = 255
        raw = server.encode_mask_png(mask)
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        self.assertEqual(im.getpixel((0, 0))[3], 0)
        self.assertEqual(im.getpixel((1, 1))[3], 255)


class DetectDeviceTests(unittest.TestCase):
    def test_forced_device_wins(self):
        self.assertEqual(server.detect_device("cpu"), "cpu")
        self.assertEqual(server.detect_device("cuda"), "cuda")

    def test_intel_mac_skips_broken_mps(self):
        """x86_64 torch can report MPS available without working ops."""
        import platform
        import unittest.mock as mock

        if platform.machine() != "x86_64":
            self.skipTest("Intel Mac only")
        fake_torch = mock.MagicMock()
        fake_torch.cuda.is_available.return_value = False
        fake_torch.backends.mps.is_available.return_value = True
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            self.assertEqual(server.detect_device(), "cpu")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["SAM_DEMO"] = "1"
        server.load_predictor()
        cls.client = TestClient(server.app)

    def test_health_is_demo(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["demo"])
        self.assertEqual(body["model"], "demo-floodfill")

    def test_empty_upload_is_rejected(self):
        res = self.client.post("/v1/sessions", files={"image": ("x.png", b"", "image/png")})
        self.assertEqual(res.status_code, 400)

    def test_session_and_demo_predict(self):
        res = self.client.post("/v1/sessions", files={"image": ("x.png", _png(), "image/png")})
        self.assertEqual(res.status_code, 200)
        sid = res.json()["session_id"]
        self.assertEqual(res.json()["width"], 32)
        bad = self.client.post(f"/v1/sessions/{sid}/predict", json={"points": []})
        self.assertEqual(bad.status_code, 400)
        pred = self.client.post(
            f"/v1/sessions/{sid}/predict",
            json={"points": [{"x": 8, "y": 8, "label": 1}]},
        )
        self.assertEqual(pred.status_code, 200)
        self.assertEqual(pred.headers["content-type"], "image/png")
        im = Image.open(io.BytesIO(pred.content)).convert("RGBA")
        self.assertGreater(im.getpixel((8, 8))[3], 200)
        self.assertEqual(im.getpixel((0, 0))[3], 0)

    def test_unknown_session(self):
        res = self.client.post(
            "/v1/sessions/not-a-session/predict",
            json={"points": [{"x": 1, "y": 1, "label": 1}]},
        )
        self.assertEqual(res.status_code, 404)

    def test_resolve_local_weights_prefers_existing_file(self):
        ckpt = ROOT / "sam2" / "checkpoints" / "sam2.1_hiera_small.pt"
        path, cfg = server.resolve_local_weights()
        if ckpt.is_file():
            self.assertTrue(path.endswith("sam2.1_hiera_small.pt"))
            self.assertIn("hiera_s", cfg)
        else:
            self.assertIsNone(path)


if __name__ == "__main__":
    unittest.main()

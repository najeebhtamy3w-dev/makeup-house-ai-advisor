"""Asset supply-chain tests; these do not measure OCR intelligence or Android execution."""
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ocr_assets', ROOT / 'scripts/prepare-ocr-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

class OCRAssetIntegrity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = pathlib.Path(self.tmp.name)
        self.cache = self.base / 'cache'
        self.target = self.base / 'assets/eng.traineddata'
        self.content = b'pinned OCR fixture\x00\xff'
        self.item = dict(url='https://example.invalid/model', size=len(self.content), sha256=hashlib.sha256(self.content).hexdigest())

    def test_verified_download_and_cache_reuse(self):
        with patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(self.content)) as network:
            assets.fetch(self.item, self.target, self.cache)
            network.assert_called_once()
        self.assertEqual(self.target.read_bytes(), self.content)
        with patch.object(assets.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
            self.target.unlink()
            assets.fetch(self.item, self.target, self.cache)
        self.assertEqual(self.target.read_bytes(), self.content)

    def test_corrupt_same_length_cache_is_replaced(self):
        self.cache.mkdir()
        (self.cache/self.target.name).write_bytes(b'x'*len(self.content))
        with patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(self.content)):
            assets.fetch(self.item, self.target, self.cache)
        self.assertTrue(assets.verified(self.target, self.item))

    def test_bad_hash_never_overwrites_existing_destination(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b'existing application asset')
        with patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(b'x'*len(self.content))):
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                assets.fetch(self.item, self.target, self.cache)
        self.assertEqual(self.target.read_bytes(), b'existing application asset')

    def test_oversized_download_never_installed(self):
        with patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(self.content+b'oversize')):
            with self.assertRaisesRegex(ValueError, 'exceeds pinned size'):
                assets.fetch(self.item, self.target, self.cache)
        self.assertFalse(self.target.exists())

    def test_actual_manifest_pins_models_engine_and_licenses(self):
        manifest=json.loads((ROOT/'native/ocr-manifest.json').read_text())
        self.assertEqual({m['id'] for m in manifest['models']}, {'eng','ara'})
        self.assertFalse(manifest['vision'])
        self.assertTrue(manifest['ocr'])
        for entry in [manifest['engine'], *manifest['models'], *manifest['licenses']]:
            self.assertTrue(entry['url'].startswith('https://'))
            self.assertRegex(entry['sha256'], r'^[a-f0-9]{64}$')
            self.assertGreater(entry['size'], 0)
        for entry in manifest['models']:
            self.assertRegex(entry['revision'],r'^[a-f0-9]{40}$')
            self.assertIn(entry['revision'],entry['url'])

if __name__ == '__main__':
    unittest.main(verbosity=2)

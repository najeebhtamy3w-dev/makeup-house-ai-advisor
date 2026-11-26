#!/usr/bin/env python3
"""Prepare only pinned OCR assets; existing application/model assets are untouched."""
import argparse, hashlib, json, pathlib, urllib.request, os
ROOT = pathlib.Path(__file__).resolve().parents[1]

def verified(path, item):
    return path.is_file() and path.stat().st_size == item['size'] and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']

def fetch(item, destination, cache):
    source = cache / destination.name
    if not verified(source, item):
        source.parent.mkdir(parents=True, exist_ok=True)
        temporary = source.with_suffix(source.suffix + '.part')
        try:
            with urllib.request.urlopen(item['url'], timeout=90) as response, temporary.open('wb') as output:
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > item['size']: raise ValueError('OCR asset exceeds pinned size')
                    output.write(chunk)
            if not verified(temporary, item):
                temporary.unlink(missing_ok=True)
                raise ValueError('OCR asset integrity mismatch: ' + destination.name)
            os.replace(temporary, source)
        finally:
            temporary.unlink(missing_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not verified(destination, item):
        temporary = destination.with_suffix(destination.suffix + '.part')
        temporary.write_bytes(source.read_bytes())
        os.replace(temporary, destination)
    print(destination.name + ': SHA256 VERIFIED')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=pathlib.Path, default=ROOT.parent / 'ocr-cache')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'native/ocr-manifest.json').read_text())
    for model in manifest['models']:
        if model['id'] not in ('eng', 'ara'): raise ValueError('Unexpected OCR model')
        fetch(model, ROOT / 'android/app/src/main/assets/ocr/tessdata' / (model['id'] + '.traineddata'), args.cache)
    fetch(manifest['engine'], ROOT / 'android/app/libs/tesseract4android-4.9.0.aar', args.cache)
    for item in manifest['licenses']:
        fetch(item, ROOT / 'android/app/src/main/assets/ocr' / (item['id'] + '-LICENSE.txt'), args.cache)
    target = ROOT / 'android/app/src/main/assets/ocr/manifest.json'
    target.write_text(json.dumps(manifest, indent=2) + '\n')

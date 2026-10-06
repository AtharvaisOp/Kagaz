"""Bounded native preflight/verification; stdout is only counts, never document text.

Uses dependencies already required by OCRmyPDF. Processing stays in OCRmyPDF.
Run in the same private directory and resource-limited process group as the engine.
"""
import hashlib
import json
import logging
import math
import sys
from collections import Counter

import pikepdf
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer, LTTextContainer
from ocrmypdf.pdfinfo import PdfInfo
from pdf_safety import validate_pdf_structure

logging.disable(logging.CRITICAL)


def contents(page):
    streams = page.obj.get('/Contents', [])
    if isinstance(streams, pikepdf.Stream):
        streams = [streams]
    return [stream.read_bytes().strip() for stream in streams]


def images(resources, depth=0, seen=None):
    if depth > 12:
        raise ValueError('resource nesting')
    seen = set() if seen is None else seen
    found = []
    for _, obj in resources.get('/XObject', {}).items():
        if obj.objgen in seen:
            continue
        seen.add(obj.objgen)
        if len(seen) > 512:
            raise ValueError('resource count')
        if obj.get('/Subtype') == '/Image':
            width, height = int(obj.get('/Width', 0)), int(obj.get('/Height', 0))
            if not 0 < width * height <= 16_000_000:
                raise ValueError('image pixels')
            # Hash encoded streams: no large image decompression just to verify retention.
            found.append(hashlib.sha256(obj.read_raw_bytes()).hexdigest())
            mask = obj.get('/SMask')
            if isinstance(mask, pikepdf.Stream):
                if int(mask.get('/Width', 0)) * int(mask.get('/Height', 0)) > 16_000_000:
                    raise ValueError('mask pixels')
                found.append(hashlib.sha256(mask.read_raw_bytes()).hexdigest())
        elif obj.get('/Subtype') == '/Form':
            found.extend(images(obj.get('/Resources', {}), depth + 1, seen))
    return found


def inventory(path):
    with pikepdf.open(path, attempt_recovery=False) as pdf:
        validate_pdf_structure(pdf, 20)
        result = []
        for page in pdf.pages:
            if page.obj.get('/Annots'):
                raise ValueError('unflattened annotations')
            box = [float(v) for v in page.mediabox]
            unit = float(page.obj.get('/UserUnit', 1))
            width, height = (box[2] - box[0]) * unit, (box[3] - box[1]) * unit
            if not all(math.isfinite(v) for v in box + [unit, width, height]) or not (0 < width <= 1008 and 0 < height <= 1008):
                raise ValueError('page dimensions')
            result.append({'geometry': (box, list(page.cropbox), unit, int(page.obj.get('/Rotate', 0)) % 360),
                           'images': Counter(images(page.resources)), 'contents': contents(page)})
    info = PdfInfo(path, max_workers=1)
    for page, facts in zip(info, result):
        dpi = max(page.dpi.x, page.dpi.y)
        if not math.isfinite(dpi) or dpi > 400 or page.width_pixels * page.height_pixels > 16_000_000:
            raise ValueError('raster budget')
        facts['existing'] = page.has_text
        facts['needs'] = not page.has_text and bool(page.images or page.has_vector)
    texts = []
    def text_from(obj):
        if isinstance(obj, (LTTextContainer, LTChar)):
            return obj.get_text()
        if isinstance(obj, LTContainer):
            return ''.join(text_from(child) for child in obj)
        return ''
    for layout in extract_pages(path):
        text = text_from(layout)
        # Only retain a digest and whether meaningful characters exist, never text itself.
        normalized = ''.join(text.split())
        texts.append((hashlib.sha256(normalized.encode()).digest(), any(c.isalnum() for c in normalized)))
    if len(texts) != len(result):
        raise ValueError('text inventory')
    for facts, text in zip(result, texts):
        facts['text'] = text
    return result


def main():
    try:
        source = inventory(sys.argv[1])
    except Exception:
        return 2  # Fail closed without printing paths, content or native exceptions.
    if len(sys.argv) == 3:
        try:
            output = inventory(sys.argv[2])
            if len(source) != len(output):
                return 1
            for before, after in zip(source, output):
                if before['geometry'] != after['geometry'] or before['images'] != after['images']:
                    return 1
                # OCRmyPDF coalesces streams and adds graphics-state wrappers.
                # Require every original stream to remain, in order, without requiring
                # its original separators to survive coalescing.
                combined = b'\n'.join(after['contents'])
                offset = 0
                for stream in before['contents']:
                    if not stream:
                        continue
                    position = combined.find(stream, offset)
                    if position < 0:
                        return 1
                    offset = position + len(stream)
                if before['existing'] and before['text'] != after['text']:
                    return 1
                if before['needs'] and not after['text'][1]:
                    return 1
        except Exception:
            return 1
    count = sum(page['needs'] for page in source)
    print(json.dumps({'pages': len(source), 'pagesOcred': count, 'pagesSkipped': len(source) - count}))
    return 0


if __name__ == '__main__':
    sys.exit(main())

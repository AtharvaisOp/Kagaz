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
from decimal import Decimal

import pikepdf
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer, LTTextContainer
from ocrmypdf.pdfinfo import PdfInfo
from pdf_safety import destination, validate_pdf_structure

logging.disable(logging.CRITICAL)


class OcrRejection(ValueError):
    """Only fixed application-owned categories may leave the inspector."""
    def __init__(self, category):
        self.category = category
        super().__init__(category)


def local_links(page, page_ids):
    """Accept only inert local links whose semantics can be verified after OCR.

    The shared scanner still examines every object first. Appearance streams,
    named destinations and tagged-annotation relationships need broader retention
    verification and remain outside this deliberately narrow compatibility path.
    Only a digest is retained; link labels and document strings never leave here.
    """
    def primitive(value, depth=0):
        if depth > 4:
            raise OcrRejection('annotations')
        if value is None:
            return None
        if isinstance(value, pikepdf.Name):
            return ['name', str(value)]
        if isinstance(value, pikepdf.String):
            return ['string', str(value)]
        if not isinstance(value, bool) and isinstance(value, (int, float, Decimal)):
            number = float(value)
            if math.isfinite(number):
                return number
        if isinstance(value, pikepdf.Array) and len(value) <= 128:
            return [primitive(child, depth + 1) for child in value]
        raise OcrRejection('annotations')

    def numbers(value, count=None):
        if not isinstance(value, pikepdf.Array) or len(value) > 128:
            return False
        if count is not None and len(value) != count:
            return False
        return all(not isinstance(number, bool)
                   and isinstance(number, (int, float, Decimal))
                   and math.isfinite(number) for number in value)

    allowed = {'/Type', '/Subtype', '/Rect', '/A', '/Dest', '/Border', '/BS', '/H',
               '/F', '/C', '/Contents', '/NM', '/P', '/QuadPoints'}
    links = []
    for annotation in page.obj.get('/Annots', []):
        if (not isinstance(annotation, pikepdf.Dictionary)
                or annotation.get('/Subtype') != '/Link'
                or annotation.get('/Type', '/Annot') != '/Annot'
                or not set(annotation.keys()) <= allowed):
            raise OcrRejection('annotations')
        if '/P' in annotation and (not isinstance(annotation['/P'], pikepdf.Dictionary)
                                   or annotation['/P'].objgen != page.obj.objgen):
            raise OcrRejection('annotations')
        rect = annotation.get('/Rect')
        if not numbers(rect, 4) or rect[2] < rect[0] or rect[3] < rect[1]:
            raise OcrRejection('annotations')
        if '/Border' in annotation:
            border = annotation['/Border']
            if (not isinstance(border, pikepdf.Array) or len(border) not in (3, 4)
                    or not numbers(pikepdf.Array(list(border)[:3]), 3)
                    or any(value < 0 for value in list(border)[:3])
                    or (len(border) == 4 and (not numbers(border[3])
                                             or any(value < 0 for value in border[3])))):
                raise OcrRejection('annotations')
        border_style = annotation.get('/BS')
        if '/BS' in annotation:
            if (not isinstance(border_style, pikepdf.Dictionary)
                    or not set(border_style.keys()) <= {'/Type', '/W', '/S', '/D'}
                    or border_style.get('/Type', '/Border') != '/Border'
                    or not numbers(pikepdf.Array([border_style.get('/W', 1)]), 1)
                    or border_style.get('/W', 1) < 0
                    or str(border_style.get('/S', '/S')) not in ('/S', '/D', '/B', '/I', '/U')):
                raise OcrRejection('annotations')
            if '/S' in border_style and not isinstance(border_style['/S'], pikepdf.Name):
                raise OcrRejection('annotations')
            if '/D' in border_style:
                dash = border_style['/D']
                if (not numbers(dash) or any(value < 0 for value in dash)
                        or (len(dash) > 0 and not any(value > 0 for value in dash))):
                    raise OcrRejection('annotations')
        if '/C' in annotation:
            color = annotation['/C']
            if (not numbers(color) or len(color) not in (0, 1, 3, 4)
                    or any(not 0 <= value <= 1 for value in color)):
                raise OcrRejection('annotations')
        if '/H' in annotation and (not isinstance(annotation['/H'], pikepdf.Name)
                                   or str(annotation['/H']) not in ('/N', '/I', '/O', '/P')):
            raise OcrRejection('annotations')
        if '/F' in annotation and (not isinstance(annotation['/F'], int)
                                   or isinstance(annotation['/F'], bool)
                                   or not 0 <= annotation['/F'] <= 2**31 - 1):
            raise OcrRejection('annotations')
        if '/QuadPoints' in annotation and (not numbers(annotation['/QuadPoints'])
                                           or len(annotation['/QuadPoints']) % 8 != 0):
            raise OcrRejection('annotations')
        if any(key in annotation and not isinstance(annotation[key], pikepdf.String)
               for key in ('/Contents', '/NM')):
            raise OcrRejection('annotations')
        if ('/A' in annotation) == ('/Dest' in annotation):
            raise OcrRejection('annotations')
        target = annotation.get('/Dest')
        if '/A' in annotation:
            # action() in pdf_safety has already restricted this to local GoTo.
            target = annotation['/A']['/D']
        if (not isinstance(target, pikepdf.Array) or len(target) < 2
                or not isinstance(target[0], pikepdf.Dictionary)
                or not isinstance(target[1], pikepdf.Name)
                or target[0].objgen not in page_ids):
            raise OcrRejection('annotations')
        try:
            destination(target, set(page_ids))
        except Exception:
            raise OcrRejection('annotations') from None
        values = {key: primitive(value) for key, value in annotation.items()
                  if key not in ('/Type', '/Subtype', '/A', '/Dest', '/P', '/BS')}
        if border_style is not None:
            values['/BS'] = {key: primitive(value) for key, value in border_style.items()}
        # Object IDs change during rewriting; destination page identity must not.
        values['destination'] = [page_ids[target[0].objgen],
                                 *[primitive(value) for value in list(target)[1:]]]
        links.append(values)
    return hashlib.sha256(json.dumps(links, sort_keys=True).encode()).digest()


def contents(page):
    streams = page.obj.get('/Contents', [])
    if isinstance(streams, pikepdf.Stream):
        streams = [streams]
    return [stream.read_bytes().strip() for stream in streams]


def images(resources, depth=0, seen=None):
    if depth > 12:
        raise OcrRejection('resource-budget')
    seen = set() if seen is None else seen
    found = []
    for _, obj in resources.get('/XObject', {}).items():
        if obj.objgen in seen:
            continue
        seen.add(obj.objgen)
        if len(seen) > 512:
            raise OcrRejection('resource-budget')
        if obj.get('/Subtype') == '/Image':
            width, height = int(obj.get('/Width', 0)), int(obj.get('/Height', 0))
            if not 0 < width * height <= 16_000_000:
                raise OcrRejection('image-budget')
            # Hash encoded streams: no large image decompression just to verify retention.
            found.append(hashlib.sha256(obj.read_raw_bytes()).hexdigest())
            mask = obj.get('/SMask')
            if isinstance(mask, pikepdf.Stream):
                if int(mask.get('/Width', 0)) * int(mask.get('/Height', 0)) > 16_000_000:
                    raise OcrRejection('image-budget')
                found.append(hashlib.sha256(mask.read_raw_bytes()).hexdigest())
        elif obj.get('/Subtype') == '/Form':
            found.extend(images(obj.get('/Resources', {}), depth + 1, seen))
    return found


def inventory(path):
    with pikepdf.open(path, attempt_recovery=False) as pdf:
        try:
            validate_pdf_structure(pdf, 20)
        except Exception:
            raise OcrRejection('unsafe-structure') from None
        page_ids = {page.obj.objgen: index for index, page in enumerate(pdf.pages)}
        result = []
        for page in pdf.pages:
            links = local_links(page, page_ids)
            box = [float(v) for v in page.mediabox]
            unit = float(page.obj.get('/UserUnit', 1))
            width, height = (box[2] - box[0]) * unit, (box[3] - box[1]) * unit
            if not all(math.isfinite(v) for v in box + [unit, width, height]) or not (0 < width <= 1008 and 0 < height <= 1008):
                raise OcrRejection('page-dimensions')
            result.append({'geometry': (box, list(page.cropbox), unit, int(page.obj.get('/Rotate', 0)) % 360),
                           'images': Counter(images(page.resources)), 'contents': contents(page),
                           'links': links})
    info = PdfInfo(path, max_workers=1)
    for page, facts in zip(info, result):
        dpi = max(page.dpi.x, page.dpi.y)
        if not math.isfinite(dpi) or dpi > 400 or page.width_pixels * page.height_pixels > 16_000_000:
            raise OcrRejection('raster-budget')
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
        raise OcrRejection('text-inventory')
    for facts, text in zip(result, texts):
        facts['text'] = text
    return result


def main():
    try:
        source = inventory(sys.argv[1])
    except OcrRejection as error:
        print(json.dumps({'rejection': error.category}))
        return 2
    except pikepdf.PasswordError:
        print(json.dumps({'rejection': 'encrypted'}))
        return 2
    except Exception:
        print(json.dumps({'rejection': 'unreadable-pdf'}))
        return 2  # Fail closed without printing paths, content or native exceptions.
    if len(sys.argv) == 3:
        try:
            output = inventory(sys.argv[2])
            if len(source) != len(output):
                return 1
            for before, after in zip(source, output):
                if (before['geometry'] != after['geometry'] or before['images'] != after['images']
                        or before['links'] != after['links']):
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

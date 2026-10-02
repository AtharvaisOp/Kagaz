"""Independent bounded parser reload. Only counts leave this process."""
import json
import logging
import math
import sys
import pikepdf
from pdfminer.high_level import extract_pages

logging.disable(logging.CRITICAL)

try:
    with pikepdf.open(sys.argv[1], attempt_recovery=False) as pdf:
        if pdf.is_encrypted or not 0 < len(pdf.pages) <= 50 or '/AcroForm' in pdf.Root or '/OpenAction' in pdf.Root:
            raise ValueError()
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Dictionary) and (obj.get('/S') in (
                    '/JavaScript', '/Launch', '/URI', '/GoToR', '/GoToE', '/SubmitForm', '/ImportData') or
                    '/EmbeddedFiles' in obj or '/XFA' in obj or '/ByteRange' in obj):
                raise ValueError()
        pages = len(pdf.pages)
        for page in pdf.pages:
            box = tuple(float(value) for value in page.mediabox)
            if (not all(math.isfinite(value) for value in box) or
                    box[2] <= box[0] or box[3] <= box[1] or
                    max(box[2] - box[0], box[3] - box[1]) > 36 * 72):
                raise ValueError()
            # Actually decode drawing streams, catching truncated filters. Native
            # memory/time bounds also apply to this independent parser.
            pikepdf.parse_content_stream(page)
    if sum(1 for _ in extract_pages(sys.argv[1])) != pages:
        raise ValueError()
    print(json.dumps({'pages': pages}))
except Exception:
    sys.exit(1)

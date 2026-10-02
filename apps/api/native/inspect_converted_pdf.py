"""Independent bounded parser reload. Only counts leave this process."""
import json
import logging
import math
import sys
import pikepdf
from pdfminer.high_level import extract_pages

logging.disable(logging.CRITICAL)


def validate_open_action(root):
    action = root.get('/OpenAction')
    if action is None:
        return
    if isinstance(action, pikepdf.Dictionary):
        if action.get('/S') != '/GoTo' or '/D' not in action:
            raise ValueError('pdf-openaction-unsafe')
        action = action['/D']
    # An array or named destination is local to this PDF. A local GoTo action
    # is also safe; the general action inventory below rejects remote actions.
    if isinstance(action, pikepdf.Array):
        if (len(action) < 2 or len(action) > 6 or
                not isinstance(action[0], pikepdf.Dictionary) or
                action[0].get('/Type') != '/Page' or
                action[1] not in ('/XYZ', '/Fit', '/FitH', '/FitV', '/FitR',
                                  '/FitB', '/FitBH', '/FitBV')):
            raise ValueError('pdf-openaction-invalid-destination')
    elif not isinstance(action, (pikepdf.Name, pikepdf.String)):
        raise ValueError('pdf-openaction-invalid-destination')


try:
    with pikepdf.open(sys.argv[1], attempt_recovery=False) as pdf:
        if pdf.is_encrypted:
            raise ValueError('pdf-encrypted')
        if not 0 < len(pdf.pages) <= 50:
            raise ValueError('pdf-page-count-invalid')
        if '/AcroForm' in pdf.Root:
            raise ValueError('pdf-acroform-present')
        validate_open_action(pdf.Root)
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Dictionary) and (obj.get('/S') in (
                    '/JavaScript', '/Launch', '/URI', '/GoToR', '/GoToE', '/SubmitForm', '/ImportData') or
                    '/EmbeddedFiles' in obj or '/XFA' in obj or '/ByteRange' in obj):
                raise ValueError('pdf-forbidden-feature')
        pages = len(pdf.pages)
        for page in pdf.pages:
            box = tuple(float(value) for value in page.mediabox)
            if (not all(math.isfinite(value) for value in box) or
                    box[2] <= box[0] or box[3] <= box[1] or
                    max(box[2] - box[0], box[3] - box[1]) > 36 * 72):
                raise ValueError('pdf-invalid-page-box')
            # Actually decode drawing streams, catching truncated filters. Native
            # memory/time bounds also apply to this independent parser.
            pikepdf.parse_content_stream(page)
    if sum(1 for _ in extract_pages(sys.argv[1])) != pages:
        raise ValueError('pdf-page-count-mismatch')
    print(json.dumps({'pages': pages}))
except Exception as error:
    # Safe internal stage code only. The API maps this to a generic conversion
    # error and never returns native stderr to the client.
    marker = str(error) if str(error).startswith('pdf-') else 'pdf-reload-failed'
    print(marker, file=sys.stderr)
    sys.exit(1)

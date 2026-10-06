"""Bounded generic heavy-tool PDF safety policy. stdout contains only counts."""
import json
import logging
import sys

import pikepdf

from pdf_safety import validate_pdf_structure

logging.disable(logging.CRITICAL)

try:
    with pikepdf.open(sys.argv[1], attempt_recovery=False) as pdf:
        pages = validate_pdf_structure(pdf, int(sys.argv[2]))
    print(json.dumps({'pages': pages}))
except Exception:
    sys.exit(2)

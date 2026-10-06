"""Shared bounded PDF object inspection; no stream decoding or document logging.

qpdf's structural check is not an active-content policy. Inspect every indirect
object and its inline children, including stream dictionaries. Native process
memory/time limits remain the boundary around the parser itself.
"""
import math
from decimal import Decimal

import pikepdf

MAX_NODES = 200_000
MAX_DEPTH = 64
FORBIDDEN_KEYS = {'/AcroForm', '/XFA', '/ByteRange', '/JS', '/JavaScript',
                  '/EmbeddedFiles', '/EF', '/AF', '/FS', '/AA',
                  '/RichMediaContent', '/RichMediaSettings', '/Collection', '/OPI'}
UNSAFE_ACTIONS = {'/JavaScript', '/Launch', '/URI', '/GoToR', '/GoToE',
                  '/SubmitForm', '/ImportData', '/ResetForm', '/Hide', '/Named',
                  '/Thread', '/Sound', '/Movie', '/SetOCGState', '/Rendition',
                  '/Trans', '/GoTo3DView', '/RichMediaExecute'}
PASSIVE_ANNOTATIONS = {'/Text', '/Link', '/FreeText', '/Line', '/Square', '/Circle',
                       '/Polygon', '/PolyLine', '/Highlight', '/Underline',
                       '/Squiggly', '/StrikeOut', '/Stamp', '/Caret', '/Ink',
                       '/Popup'}
ACTIVE_ANNOTATIONS = {'/FileAttachment', '/Sound', '/Movie', '/Screen', '/Widget',
                      '/RichMedia', '/3D'}
DESTINATIONS = {'/XYZ': 5, '/Fit': 2, '/FitH': 3, '/FitV': 3, '/FitR': 6,
                '/FitB': 2, '/FitBH': 3, '/FitBV': 3}


def require(condition):
    if not condition:
        raise ValueError('pdf-unsafe-structure')


def destination(value, page_ids):
    # Named destinations are local to this PDF. Explicit destinations must point
    # to a real page, not a dictionary merely claiming to be a page.
    if isinstance(value, (pikepdf.Name, pikepdf.String)):
        return
    require(isinstance(value, pikepdf.Array) and len(value) >= 2)
    require(isinstance(value[0], pikepdf.Dictionary)
            and value[0].is_indirect and value[0].get('/Type') == '/Page'
            and value[0].objgen in page_ids)
    mode = str(value[1])
    require(mode in DESTINATIONS and len(value) == DESTINATIONS[mode])
    for number in list(value)[2:]:
        require(number is None or (not isinstance(number, bool)
                and isinstance(number, (int, float, Decimal)) and math.isfinite(number)))


def action(value, page_ids):
    require(isinstance(value, pikepdf.Dictionary)
            and value.get('/S') == '/GoTo'
            and set(value.keys()) <= {'/Type', '/S', '/D'}
            and '/D' in value)
    require('/Type' not in value or value['/Type'] == '/Action')
    destination(value['/D'], page_ids)


def validate_pdf_structure(pdf, maximum_pages):
    require(not pdf.is_encrypted and 0 < len(pdf.pages) <= maximum_pages)
    page_ids = {page.obj.objgen for page in pdf.pages}
    seen = set()
    nodes = 0
    # A depth-first stack avoids recursively walking arbitrarily nested hostile
    # inline dictionaries; indirect cycles are visited once by object identity.
    stack = [(obj, 0, None) for obj in pdf.objects]
    while stack:
        obj, depth, context = stack.pop()
        if context == '/OpenAction':
            if isinstance(obj, pikepdf.Dictionary):
                action(obj, page_ids)
            else:
                destination(obj, page_ids)
        elif context in ('/A', '/Next'):
            if context == '/Next' and isinstance(obj, pikepdf.Array):
                stack.extend((child, depth + 1, '/A') for child in obj)
            else:
                action(obj, page_ids)
        if isinstance(obj, pikepdf.Object) and obj.is_indirect:
            if obj.objgen in seen:
                continue
            seen.add(obj.objgen)
        nodes += 1
        require(nodes <= MAX_NODES and depth <= MAX_DEPTH)
        if isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
            require(not FORBIDDEN_KEYS.intersection(obj.keys()))
            require(obj.get('/Type') not in ('/Sig', '/DocTimeStamp', '/Filespec',
                                             '/EmbeddedFile'))
            require(obj.get('/FT') != '/Sig' and obj.get('/S') not in UNSAFE_ACTIONS)
            require(obj.get('/Subtype') not in ACTIVE_ANNOTATIONS)
            # PostScript XObjects are executable printing fragments, outside
            # the flattened visual derivative contract (ISO 32000-1 8.8.2).
            require(obj.get('/Subtype') != '/PS' and obj.get('/Subtype2') != '/PS')
            # Reference XObjects can ask a native processor to load another PDF
            # from a file specification; structure-element Ref arrays are local.
            if '/Ref' in obj:
                refs = obj['/Ref']
                require(not isinstance(obj, pikepdf.Stream)
                        and obj.get('/Type') == '/StructElem' and '/Subtype' not in obj
                        and isinstance(refs, pikepdf.Array)
                        and all(isinstance(ref, pikepdf.Dictionary)
                                and ref.get('/Type') == '/StructElem' for ref in refs))
            if obj.get('/Type') == '/Action':
                action(obj, page_ids)
            # /Type is optional in annotation dictionaries. Relying on it alone
            # misses valid file-attachment, multimedia and widget annotations.
            if obj.get('/Type') == '/Annot' or ('/Rect' in obj and '/Subtype' in obj):
                require(obj.get('/Subtype') in PASSIVE_ANNOTATIONS)
            if isinstance(obj, pikepdf.Stream):
                # External file streams can access server-owned paths even when
                # no embedded-file name tree exists.
                require('/F' not in obj and '/FFilter' not in obj and '/FDecodeParms' not in obj)
            for key, child in obj.items():
                child_context = key if key in ('/OpenAction', '/Next') else None
                if key == '/A' and not (obj.get('/Type') == '/StructElem'
                        and not isinstance(obj, pikepdf.Stream) and '/Subtype' not in obj):
                    child_context = '/A'
                # /Next is also used by outline linked lists; only an action's
                # Next denotes a chained action.
                if key == '/Next' and obj.get('/S') != '/GoTo' and obj.get('/Type') != '/Action':
                    child_context = None
                stack.append((child, depth + 1, child_context))
        elif isinstance(obj, pikepdf.Array):
            stack.extend((child, depth + 1, None) for child in obj)
    return len(pdf.pages)

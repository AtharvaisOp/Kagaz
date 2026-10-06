"""Fail-closed OOXML inspection. Never extract, log names/text, or repair a package.

ZIP metadata AND local records are checked before bounded decompression. All XML
and relationship parts are inspected, including unused parts. stdout is facts only.
"""
import json
import logging
import posixpath
import re
import stat
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree as ET

logging.disable(logging.CRITICAL)

MAX_INPUT = 10 * 1024 * 1024
MAX_ENTRY = 8 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_ENTRIES = 2048
MAX_RATIO = 100
MAX_XML_NODES = 200_000
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE_RELS = ('http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
               'http://purl.oclc.org/ooxml/officeDocument/relationships/')
FAMILIES = {
    'docx': ('word/document.xml', 'wordprocessingml.document', 'document'),
    'pptx': ('ppt/presentation.xml', 'presentationml.presentation', 'presentation'),
    'xlsx': ('xl/workbook.xml', 'spreadsheetml.sheet', 'workbook'),
}
BLOCKED = ('vba', 'macro', 'activex', 'embeddings', 'oleobject', 'externaldata',
           'externallink', 'attachedtemplate', 'altchunk', 'webextension',
           'connections', 'querytable', 'customui', 'printersettings', 'scripts')
IMAGES = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}


class Unsupported(Exception):
    pass


def require(condition):
    if not condition:
        raise ValueError('unsafe package')


def safe_name(name):
    # OPC URI escapes, backslashes, drive names and Unicode aliases fail closed.
    require(len(name) <= 240 and name.isascii() and '\\' not in name
            and '%' not in name and ':' not in name and not name.startswith('/'))
    require('//' not in name)
    parts = name.rstrip('/').split('/')
    require(0 < len(parts) <= 16 and all(
        p not in ('', '.', '..') and re.fullmatch(r'[A-Za-z0-9_\[\]. -]+', p)
        and not p.endswith(('.', ' ')) for p in parts))
    require(not any(token in name.lower() for token in BLOCKED))
    return name


def xml(data, package_nodes):
    text = data.decode('utf-8-sig', errors='strict')
    require('<!DOCTYPE' not in text.upper() and '<!ENTITY' not in text.upper())
    parser = ET.XMLPullParser(events=('start', 'end'))
    root = None
    depth = 0
    nodes = 0
    # Enforce the cumulative retained-tree budget while parsing. Feeding small
    # chunks bounds event allocation before the next structural-budget check.
    for offset in range(0, len(text), 64 * 1024):
        parser.feed(text[offset:offset + 64 * 1024])
        for event, element in parser.read_events():
            if event == 'start':
                nodes += 1
                package_nodes[0] += 1
                require(nodes <= MAX_XML_NODES and package_nodes[0] <= MAX_XML_NODES and depth <= 64)
                if root is None:
                    root = element
                depth += 1
            else:
                depth -= 1
    parser.close()
    require(root is not None and depth == 0)
    stack = [root]
    while stack:
        element = stack.pop()
        local = element.tag.rsplit('}', 1)[-1].lower()
        require(not any(token in local for token in BLOCKED))
        require(local not in ('object', 'control', 'dde', 'ddelink', 'ddelinks',
                              'oleobj', 'subdoc', 'contentpart'))
        for key, value in element.attrib.items():
            attr = key.rsplit('}', 1)[-1].lower()
            if attr in ('href', 'src', 'url'):
                # Relationship references are validated separately. Direct resource
                # paths/URLs (e.g. VML image src) are never handed to LibreOffice.
                require(not value or value.startswith('#'))
            if attr == 'instr':
                require(re.fullmatch(r'\s*(PAGE|NUMPAGES)\s*', value, re.I))
        if local == 'instrtext':
            require(re.fullmatch(r'\s*(PAGE|NUMPAGES)\s*', element.text or '', re.I))
        if local in ('f', 'formula', 'formula1', 'formula2'):
            safe_formula(element.text or '')
            if local == 'f':
                require(not element.attrib)  # shared/array/data-table variants
        if local == 'definedname':
            # Print areas/titles are common in XLSX and can affect pagination.
            # Other defined-name formulas are accepted only when they fit the
            # same local arithmetic/function grammar as cell formulas.
            require(set(element.attrib) <= {'name', 'localSheetId', 'hidden'})
            require(element.get('name') and len(element.get('name')) <= 255)
            local_sheet = element.get('localSheetId')
            require(local_sheet is None or local_sheet.isdecimal())
            formula = element.text or ''
            require(formula.strip())
            safe_formula(formula)
        stack.extend(element)
    return root


def safe_formula(formula):
    # Only local arithmetic/ranges and a small safe function set. No DDE,
    # remote functions, add-ins, external books or indirect references.
    require(re.fullmatch(r"[A-Za-z0-9_ .+$:!',()*/=<>-]*", formula))
    functions = re.findall(r'([A-Za-z_][A-Za-z0-9_.]*)\s*\(', formula)
    require(all(f.upper() in {'SUM', 'MIN', 'MAX', 'AVERAGE', 'COUNT',
                             'ROUND', 'ABS', 'IF', 'AND', 'OR'}
                for f in functions))


def zip_structure(path, archive):
    infos = archive.infolist()
    require(0 < len(infos) <= MAX_ENTRIES)
    data = Path(path).read_bytes()  # bounded input, never expanded archive
    end = data.rfind(b'PK\x05\x06')
    require(end >= 0 and end + 22 <= len(data))
    _, disk, start_disk, disk_entries, count, central_size, central, comment = struct.unpack_from('<4s4H2LH', data, end)
    require(disk == start_disk == 0 and count == disk_entries == len(infos)
            and central + central_size == end and end + 22 + comment == len(data)
            and comment <= 1024)
    names = set()
    expanded = 0
    cursor = 0
    directory_cursor = central
    for info in sorted(infos, key=lambda i: i.header_offset):
        safe_name(info.filename)
        alias = info.filename.lower().rstrip('/')
        require(alias not in names)
        names.add(alias)
        mode = info.external_attr >> 16
        require(not stat.S_ISLNK(mode) and stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR))
        require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                and info.flag_bits & ~0x808 == 0)  # UTF-8 + data descriptor only; no encryption
        require(info.file_size <= MAX_ENTRY
                and info.file_size <= MAX_RATIO * max(info.compress_size, 1))
        expanded += info.file_size
        require(expanded <= MAX_EXPANDED)
        require(info.header_offset == cursor and cursor + 30 <= central)
        signature, _, flags, method, _, _, crc, compressed, size, name_len, extra_len = struct.unpack_from('<4s5H3L2H', data, cursor)
        require(signature == b'PK\x03\x04' and flags == info.flag_bits and method == info.compress_type)
        name = data[cursor + 30:cursor + 30 + name_len].decode('utf-8' if flags & 0x800 else 'cp437')
        require(name == info.filename and '\x00' not in name)
        if not flags & 8:
            require((crc, compressed, size) == (info.CRC, info.compress_size, info.file_size))
        else:
            require((crc, compressed, size) in ((0, 0, 0), (info.CRC, info.compress_size, info.file_size)))
        cursor += 30 + name_len + extra_len + info.compress_size
        if flags & 8:
            if data[cursor:cursor + 4] == b'PK\x07\x08':
                cursor += 4
            require(cursor + 12 <= central and struct.unpack_from('<3L', data, cursor) == (info.CRC, info.compress_size, info.file_size))
            cursor += 12
        require(cursor <= central)
    require(cursor == central)
    # Disallow ZIP64, alternative names/encryption in extra fields, and a second
    # central-directory interpretation. zipfile already verifies directory names.
    for info in infos:
        require(data[directory_cursor:directory_cursor + 4] == b'PK\x01\x02')
        name_len, extra_len, comment_len = struct.unpack_from('<3H', data, directory_cursor + 28)
        require(struct.unpack_from('<H', data, directory_cursor + 34)[0] == 0)
        for extra in (info.extra, data[info.header_offset + 30 + len(info.filename.encode('utf-8')):
                                      info.header_offset + 30 + len(info.filename.encode('utf-8')) +
                                      struct.unpack_from('<H', data, info.header_offset + 28)[0]]):
            position = 0
            while position < len(extra):
                require(position + 4 <= len(extra))
                kind, length = struct.unpack_from('<2H', extra, position)
                require(kind in (0x5455, 0x000A, 0x7875) and position + 4 + length <= len(extra))
                position += 4 + length
        directory_cursor += 46 + name_len + extra_len + comment_len
    require(directory_cursor == end)
    return infos, data


def entry_bytes(info, archive_data):
    start = info.header_offset + 30
    name_length, extra_length = struct.unpack_from('<2H', archive_data, info.header_offset + 26)
    start += name_length + extra_length
    compressed = archive_data[start:start + info.compress_size]
    if info.compress_type == zipfile.ZIP_STORED:
        require(info.compress_size == info.file_size)
        data = compressed
    else:
        # ZipExtFile truncates to the declared expanded size. An adversary can
        # give it a matching prefix CRC while hiding additional DEFLATE output.
        # Independently require a complete, single bounded stream and exact size.
        decoder = zlib.decompressobj(-15)
        data = decoder.decompress(compressed, MAX_ENTRY + 1)
        require(len(data) <= MAX_ENTRY and decoder.eof
                and not decoder.unconsumed_tail and not decoder.unused_data)
    require(len(data) == info.file_size and zlib.crc32(data) == info.CRC)
    return data


def inspect(path):
    size = Path(path).stat().st_size
    require(0 < size <= MAX_INPUT)
    with open(path, 'rb') as stream:
        magic = stream.read(4)
    if magic != b'PK\x03\x04':
        raise Unsupported()
    with zipfile.ZipFile(path) as archive:
        infos, archive_data = zip_structure(path, archive)
        roots = {}
        media = {}
        total = 0
        package_nodes = [0]
        for info in infos:
            data = entry_bytes(info, archive_data)
            if info.is_dir():
                require(info.file_size == 0)
                continue
            extension = info.filename.rsplit('.', 1)[-1].lower()
            require(extension in {'xml', 'rels', *IMAGES})
            total += len(data)
            require(total <= MAX_EXPANDED)
            if extension in IMAGES:
                from PIL import Image
                import io
                with Image.open(io.BytesIO(data)) as image:
                    require(image.format == ('PNG' if extension == 'png' else 'JPEG')
                            and 0 < image.width * image.height <= 16_000_000)
                    image.verify()
                media[info.filename] = IMAGES[extension]
            else:
                roots[info.filename] = xml(data, package_nodes)
        types = roots.get('[Content_Types].xml')
        require(types is not None and types.tag == f'{{{CT}}}Types')
        overrides, defaults = {}, {}
        for element in types:
            require(element.tag in (f'{{{CT}}}Default', f'{{{CT}}}Override'))
            content = element.get('ContentType', '')
            require(content and not any(token in content.lower() for token in BLOCKED))
            if element.tag.endswith('Default'):
                key = element.get('Extension', '').lower()
                require(key and key not in defaults)
                defaults[key] = content
            else:
                key = element.get('PartName', '')
                require(key.startswith('/') and key[1:] in roots.keys() | media.keys() and key not in overrides)
                overrides[key] = content
        family = None
        for candidate, (main, subtype, _) in FAMILIES.items():
            if overrides.get('/' + main) == f'application/vnd.openxmlformats-officedocument.{subtype}.main+xml':
                require(family is None)
                family = candidate
        if family is None:
            raise Unsupported()
        main, _, root_tag = FAMILIES[family]
        require(main in roots and roots[main].tag.rsplit('}', 1)[-1] == root_tag)
        require(not any(name.startswith(prefix) for prefix in ('word/', 'ppt/', 'xl/')
                        if prefix != main.split('/')[0] + '/' for name in roots.keys() | media.keys()))
        files = roots.keys() | media.keys()
        for name in files - {'[Content_Types].xml'}:
            extension = name.rsplit('.', 1)[-1].lower()
            content = overrides.get('/' + name, defaults.get(extension, ''))
            if name in media:
                require(content == media[name])
            elif extension == 'rels':
                require(content == 'application/vnd.openxmlformats-package.relationships+xml')
            else:
                require(content in ('application/xml', 'text/xml', 'application/vnd.ms-word.stylesWithEffects+xml') or
                        content.startswith(('application/vnd.openxmlformats-officedocument.', 'application/vnd.openxmlformats-package.')) and content.endswith('+xml'))
        require('_rels/.rels' in roots)
        main_relationships = []
        relationships = {}
        relationship_types = {}
        for name, root in roots.items():
            if not name.endswith('.rels'):
                continue
            require(root.tag == f'{{{REL}}}Relationships')
            if name == '_rels/.rels':
                base = ''
            else:
                parent, leaf = posixpath.split(name)
                require(parent.endswith('/_rels') and leaf.endswith('.rels'))
                source = posixpath.join(parent[:-6], leaf[:-5])
                require(source in files)
                base = posixpath.dirname(source)
            ids = {}
            kinds = {}
            for element in root:
                require(element.tag == f'{{{REL}}}Relationship')
                target, identifier, kind = (element.get(k, '') for k in ('Target', 'Id', 'Type'))
                require(element.get('TargetMode', 'Internal') == 'Internal'
                        and identifier and identifier not in ids and target
                        and not any(token in kind.lower() for token in BLOCKED)
                        and (kind.startswith(OFFICE_RELS + ('http://schemas.openxmlformats.org/package/2006/relationships/',)) or
                             kind == 'http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects'))
                require(not re.search(r'[:\\%?#\x00-\x20]', target) and not target.startswith('//'))
                resolved = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(base, target))
                require(resolved in files)
                ids[identifier] = resolved
                kinds[identifier] = kind
                if name == '_rels/.rels' and kind in tuple(prefix + 'officeDocument' for prefix in OFFICE_RELS):
                    main_relationships.append(resolved)
            relationships[name] = ids
            relationship_types[name] = kinds
        require(main_relationships == [main])
        count = 0
        if family in ('pptx', 'xlsx'):
            tag = 'sldId' if family == 'pptx' else 'sheet'
            rel_name = posixpath.join(posixpath.dirname(main), '_rels', posixpath.basename(main) + '.rels')
            ids = relationships.get(rel_name, {})
            for element in roots[main].iter():
                if element.tag.rsplit('}', 1)[-1] != tag:
                    continue
                identifier = next((v for k, v in element.attrib.items() if k.endswith('}id')), '')
                require(identifier in ids)
                target = ids[identifier]
                kind = relationship_types[rel_name][identifier]
                if family == 'pptx':
                    require(kind.endswith('/slide') and re.fullmatch(r'ppt/slides/slide[0-9]+\.xml', target)
                            and roots.get(target) is not None
                            and roots[target].tag.rsplit('}', 1)[-1] == 'sld')
                else:
                    require(kind.endswith('/worksheet') and target.startswith('xl/worksheets/')
                            and target.endswith('.xml') and roots.get(target) is not None
                            and roots[target].tag.rsplit('}', 1)[-1] == 'worksheet')
                count += 1
            require(0 < count <= (50 if family == 'pptx' else 20))
        return {'format': family, 'units': count, 'expandedBytes': total}


if __name__ == '__main__':
    try:
        print(json.dumps(inspect(sys.argv[1])))
    except Unsupported:
        sys.exit(3)
    except Exception:
        sys.exit(2)

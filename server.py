import http.server
import socketserver
import json
import os
import re
import io
import html
import base64
import binascii
import time
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', '8080'))
DIRECTORY = os.path.abspath(os.environ.get('PLANER_STATIC_DIR') or os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.abspath(os.environ.get('PLANER_DATA_DIR') or DIRECTORY)
MAX_JSON_BYTES = 8 * 1024 * 1024
# Upload posílá base64 (+ prefix) — objem je cca 4/3 oproti souboru; zvlášť vyšší strop než u save-project
MAX_UPLOAD_POST_BYTES = 80 * 1024 * 1024
MAX_IMAGE_BYTES = 45 * 1024 * 1024  # ~odpovídá base64 v MAX_UPLOAD_POST_BYTES
MAX_MASTER_POST_BYTES = 32 * 1024 * 1024  # JSON { id, html } — hlavní dokument
MAX_MASTER_FILE_BYTES = 28 * 1024 * 1024  # uložený .master.html na disku

# Ujistíme se, že složky existují (data v PLANER_DATA_DIR / userData)
PROJECTS_DIR = os.path.join(DATA_DIR, "Projects")
IMAGES_DIR = os.path.join(DATA_DIR, "Images")
DOCUMENTS_DIR = os.path.join(DATA_DIR, "Documents")
os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(DOCUMENTS_DIR, exist_ok=True)

_NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
_NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
_TAG_H = '{%s}h' % _NS_TEXT
_TAG_P = '{%s}p' % _NS_TEXT
_TAG_LIST = '{%s}list' % _NS_TEXT
_TAG_LIST_ITEM = '{%s}list-item' % _NS_TEXT
_TAG_LINE_BREAK = '{%s}line-break' % _NS_TEXT
_ATTR_OUTLINE = '{%s}outline-level' % _NS_TEXT


def _safe_project_id(proj_id):
    if not isinstance(proj_id, str) or len(proj_id) > 128:
        return None
    return "".join([c for c in proj_id if c.isalnum() or c in ('_', '-')])


def _master_html_path(safe_id):
    return os.path.join(PROJECTS_DIR, f"{safe_id}.master.html")


def odt_bytes_to_html(data: bytes) -> str:
    """Jednoduchý ODT → HTML (odstavce, nadpisy, odrážky) přes content.xml."""
    try:
        with zipfile.ZipFile(io.BytesIO(data), 'r') as zf:
            xml_bytes = zf.read('content.xml')
    except (KeyError, zipfile.BadZipFile):
        return '<p>(Nelze přečíst ODT — poškozený soubor.)</p>'
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return '<p>(Chyba parsování ODT.)</p>'

    body = root.find('.//{%s}body' % _NS_OFFICE)
    if body is None:
        body = root

    chunks = []

    def run_text(el):
        parts = []
        if el.text:
            parts.append(html.escape(el.text))
        for c in el:
            tag = c.tag.split('}')[-1] if '}' in c.tag else c.tag
            if c.tag == _TAG_LINE_BREAK:
                parts.append('<br/>')
            elif tag in ('span', 'a', 's', 'ruby', 'title'):
                parts.append(run_text(c))
            else:
                parts.append(run_text(c))
            if c.tail:
                parts.append(html.escape(c.tail))
        return ''.join(parts)

    def walk(el):
        if el.tag == _TAG_H:
            try:
                lvl = int(el.get(_ATTR_OUTLINE, '1'))
            except ValueError:
                lvl = 1
            lvl = min(6, max(1, lvl))
            chunks.append('<h%d>%s</h%d>' % (lvl, run_text(el), lvl))
            return
        if el.tag == _TAG_P:
            chunks.append('<p>%s</p>' % run_text(el))
            return
        if el.tag == _TAG_LIST:
            chunks.append('<ul>')
            for li in el:
                if li.tag != _TAG_LIST_ITEM:
                    continue
                chunks.append('<li>')
                for ch in li:
                    walk(ch)
                chunks.append('</li>')
            chunks.append('</ul>')
            return
        for ch in el:
            walk(ch)

    walk(body)
    return '\n'.join(chunks) if chunks else '<p></p>'


def pdf_bytes_to_html(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return '<p><em>Nainstaluj závislosti: pip install pypdf — pak znovu importuj PDF.</em></p>'
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as e:
        return '<p><em>PDF nelze přečíst: %s</em></p>' % html.escape(str(e))
    parts = []
    for i, page in enumerate(reader.pages):
        try:
            txt = page.extract_text() or ''
        except Exception:
            txt = ''
        esc = html.escape(txt).replace('\n', '<br/>')
        parts.append('<hr data-master-page="%d"/><p data-master-page="%d">%s</p>' % (i + 1, i + 1, esc))
    return '\n'.join(parts) if parts else '<p></p>'

class PlanerRequestHandler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    # Bezpečnost: Povolit pouze z localhostu
    def check_origin(self):
        client_ip = self.client_address[0]
        if client_ip not in ['127.0.0.1', '::1', 'localhost']:
            self.send_error(403, "Access Denied: Only localhost is allowed.")
            return False
        return True

    def end_headers(self):
        path_only = (self.path or '').split('?', 1)[0]
        if not (path_only.startswith('/Images/') or path_only.startswith('/Documents/') or path_only.startswith('/fonts/')):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if not self.check_origin(): return

        parsed = urlparse(self.path)
        path_only = parsed.path

        if path_only == '/api/ping':
            self.handle_ping()
        elif path_only == '/api/load-projects':
            self.handle_load_projects()
        elif path_only == '/api/master-doc':
            qs = parse_qs(parsed.query or '')
            raw_id = (qs.get('id') or [''])[0]
            self.handle_get_master_doc(raw_id)
        elif path_only.startswith('/Images/') or path_only.startswith('/Documents/'):
            self.handle_data_file(path_only)
        else:
            super().do_GET()

    def handle_data_file(self, path_only):
        """Servíruje Images/ a Documents/ z PLANER_DATA_DIR (mimo static root)."""
        if path_only.startswith('/Images/'):
            base = IMAGES_DIR
            rel = path_only[len('/Images/'):]
        else:
            base = DOCUMENTS_DIR
            rel = path_only[len('/Documents/'):]
        # Jen název souboru — žádné path traversal / podsložky
        name = os.path.basename(rel)
        if not name or name != rel:
            self.send_error(400, "Invalid path")
            return
        filepath = os.path.join(base, name)
        if not os.path.isfile(filepath):
            self.send_error(404, "File not found")
            return
        try:
            with open(filepath, 'rb') as f:
                data = f.read()
        except OSError:
            self.send_error(500, "Failed to read file")
            return
        ext = os.path.splitext(name)[1].lower()
        ctype = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.pdf': 'application/pdf',
            '.odt': 'application/vnd.oasis.opendocument.text',
        }.get(ext, 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


    def do_POST(self):
        if not self.check_origin(): return
        
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty payload")
            return
        post_path = self.path.split('?', 1)[0]
        if post_path in ('/api/upload-image', '/api/import-master'):
            max_body = MAX_UPLOAD_POST_BYTES
        elif post_path == '/api/save-master':
            max_body = MAX_MASTER_POST_BYTES
        else:
            max_body = MAX_JSON_BYTES
        if content_length > max_body:
            self.send_error(413, "Payload too large")
            return
            
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(post_data)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON data")
            return

        if post_path == '/api/save-project':
            self.handle_save_project(data)
        elif post_path == '/api/upload-image':
            self.handle_upload_image(data)
        elif post_path == '/api/delete-project':
            self.handle_delete_project(data)
        elif post_path == '/api/save-master':
            self.handle_save_master(data)
        elif post_path == '/api/import-master':
            self.handle_import_master(data)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_ping(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))

    def handle_save_project(self, data):
        # Očekává formát: { "project": { id: "proj_123", name: "Hra", ... } }
        project_data = data.get('project')
        if not isinstance(project_data, dict) or 'id' not in project_data:
            self.send_error(400, "Missing project ID")
            return
            
        proj_id = project_data['id']
        safe_id = _safe_project_id(proj_id)
        if not safe_id:
            self.send_error(400, "Invalid project ID")
            return
        filepath = os.path.join(PROJECTS_DIR, f"{safe_id}.json")

        tmp_fd, tmp_path = tempfile.mkstemp(dir=PROJECTS_DIR, suffix='.tmp')
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                json.dump(project_data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, filepath)
        except Exception as e:
            try: os.unlink(tmp_path)
            except OSError: pass
            self.send_error(500, "Failed to save project: %s" % str(e))
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))

    def handle_load_projects(self):
        projects = []
        for filename in os.listdir(PROJECTS_DIR):
            if filename.endswith(".json"):
                with open(os.path.join(PROJECTS_DIR, filename), 'r', encoding='utf-8') as f:
                    try:
                        projects.append(json.load(f))
                    except:
                        pass
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"projects": projects}).encode('utf-8'))

    def handle_get_master_doc(self, proj_id):
        safe_id = _safe_project_id(proj_id)
        if not safe_id:
            self.send_error(400, "Invalid project ID")
            return
        path = _master_html_path(safe_id)
        if not os.path.isfile(path):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'')
            return
        try:
            with open(path, 'r', encoding='utf-8') as f:
                html_body = f.read()
        except Exception:
            self.send_error(500, "Failed to read master document")
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html_body.encode('utf-8'))

    def handle_save_master(self, data):
        proj_id = data.get('id')
        html_content = data.get('html')
        if html_content is not None and not isinstance(html_content, str):
            self.send_error(400, "Invalid html field")
            return
        safe_id = _safe_project_id(proj_id)
        if not safe_id:
            self.send_error(400, "Invalid project ID")
            return
        raw = html_content if isinstance(html_content, str) else ''
        if len(raw.encode('utf-8')) > MAX_MASTER_FILE_BYTES:
            self.send_error(413, "Master document too large")
            return
        path = _master_html_path(safe_id)
        tmp_fd, tmp_path = tempfile.mkstemp(dir=PROJECTS_DIR, suffix='.tmp')
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                f.write(raw)
            os.replace(tmp_path, path)
        except Exception as e:
            try: os.unlink(tmp_path)
            except OSError: pass
            self.send_error(500, "Failed to save master: %s" % str(e))
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))

    def handle_import_master(self, data):
        proj_id = data.get('id')
        raw_base64 = data.get('base64')
        orig_filename = data.get('filename', 'document.pdf')
        if not raw_base64:
            self.send_error(400, "No base64 data provided")
            return
        safe_id = _safe_project_id(proj_id)
        if not safe_id:
            self.send_error(400, "Invalid project ID")
            return
        prefix_l = ''
        if ',' in raw_base64:
            prefix, b64 = raw_base64.split(',', 1)
            prefix_l = prefix.lower()
        else:
            b64 = raw_base64
        b64 = re.sub(r'\s+', '', (b64 or '').strip())
        b64 = b64.replace('-', '+').replace('_', '/')
        pad = (-len(b64)) % 4
        if pad:
            b64 += '=' * pad
        try:
            try:
                decoded = base64.b64decode(b64, validate=True)
            except (binascii.Error, ValueError):
                decoded = base64.b64decode(b64, validate=False)
        except Exception:
            self.send_error(400, "Invalid base64")
            return
        if len(decoded) == 0:
            self.send_error(400, "Empty file")
            return
        if len(decoded) > MAX_UPLOAD_POST_BYTES:
            self.send_error(413, "File too large")
            return

        ext = os.path.splitext(orig_filename)[1].lower() or '.pdf'
        if ext not in ('.pdf', '.odt'):
            if 'pdf' in prefix_l:
                ext = '.pdf'
            elif 'opendocument' in prefix_l or 'officedocument' in prefix_l:
                ext = '.odt'
            else:
                ext = '.pdf'

        doc_name = "doc_%d%s" % (time.time_ns(), ext)
        doc_path = os.path.join(DOCUMENTS_DIR, doc_name)
        try:
            with open(doc_path, 'wb') as f:
                f.write(decoded)
        except Exception as e:
            self.send_error(500, "Failed to store file: %s" % str(e))
            return

        rel_url = "Documents/%s" % doc_name
        if ext == '.odt':
            html_out = odt_bytes_to_html(decoded)
            source_type = 'odt'
        else:
            html_out = pdf_bytes_to_html(decoded)
            source_type = 'pdf'

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            "html": html_out,
            "pdfPreviewUrl": rel_url if source_type == 'pdf' else None,
            "sourceType": source_type,
            "sourceFileName": orig_filename,
        }, ensure_ascii=False).encode('utf-8'))

    def handle_delete_project(self, data):
        proj_id = data.get('id')
        if not proj_id:
            self.send_error(400, "Missing project ID")
            return
        safe_id = _safe_project_id(proj_id)
        if not safe_id:
            self.send_error(400, "Invalid project ID")
            return
        filepath = os.path.join(PROJECTS_DIR, f"{safe_id}.json")
        master_path = _master_html_path(safe_id)
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
            if os.path.exists(master_path):
                os.remove(master_path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "deleted"}).encode('utf-8'))
        except Exception as e:
            self.send_error(500, f"Failed to delete project: {str(e)}")

    def handle_upload_image(self, data):
        # Očekává: { "filename": "concept.png", "base64": "data:image/png;base64,iVBORw..." }
        raw_base64 = data.get('base64')
        orig_filename = data.get('filename', 'image.png')
        
        if not raw_base64:
            self.send_error(400, "No base64 data provided")
            return
        if not isinstance(raw_base64, str):
            self.send_error(400, "Invalid image payload")
            return

        prefix_l = ''
        if ',' in raw_base64:
            prefix, img_data = raw_base64.split(',', 1)
            prefix_l = prefix.lower()
        else:
            img_data = raw_base64

        # Odstranění mezer/řádků z base64 (některé prohlížeče PNG rozdělí), URL-safe → standardní
        img_data = re.sub(r'\s+', '', (img_data or '').strip())
        img_data = img_data.replace('-', '+').replace('_', '/')
        pad = (-len(img_data)) % 4
        if pad:
            img_data += '=' * pad

        try:
            try:
                decoded = base64.b64decode(img_data, validate=True)
            except (binascii.Error, ValueError):
                decoded = base64.b64decode(img_data, validate=False)
        except Exception:
            self.send_error(400, "Invalid base64 image data")
            return

        if len(decoded) == 0:
            self.send_error(400, "Empty image data")
            return

        if len(decoded) > MAX_IMAGE_BYTES:
            self.send_error(413, "Image too large")
            return

        ext = os.path.splitext(orig_filename)[1]
        if not ext:
            ext = ".png"
        ext_lower = ext.lower()
        if 'image/png' in prefix_l and ext_lower not in ('.png', '.apng'):
            ext = '.png'
        elif ('image/jpeg' in prefix_l or 'image/jpg' in prefix_l) and ext_lower not in ('.jpg', '.jpeg', '.jpe'):
            ext = '.jpg'
        elif 'image/webp' in prefix_l:
            ext = '.webp'
        elif 'image/gif' in prefix_l:
            ext = '.gif'

        unique_name = f"img_{time.time_ns()}{ext}"
        filepath = os.path.join(IMAGES_DIR, unique_name)
        
        try:
            with open(filepath, 'wb') as f:
                f.write(decoded)
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"url": f"Images/{unique_name}"}).encode('utf-8'))
        except Exception as e:
            self.send_error(500, f"Failed to block writing image: {str(e)}")

if __name__ == '__main__':
    # Allow quick restart during Electron relaunch (Windows)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), PlanerRequestHandler) as httpd:
        print(f"Server běží (localhost only) na portu {PORT}")
        print(f"  static: {DIRECTORY}")
        print(f"  data:   {DATA_DIR}")
        httpd.serve_forever()

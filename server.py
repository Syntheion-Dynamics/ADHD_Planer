import http.server
import socketserver
import json
import os
import base64
import time

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Ujistíme se, že složky existují
PROJECTS_DIR = os.path.join(DIRECTORY, "Projects")
IMAGES_DIR = os.path.join(DIRECTORY, "Images")
os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)

class PlanerRequestHandler(http.server.SimpleHTTPRequestHandler):
    
    # Bezpečnost: Povolit pouze z localhostu
    def check_origin(self):
        client_ip = self.client_address[0]
        if client_ip not in ['127.0.0.1', '::1', 'localhost']:
            self.send_error(403, "Access Denied: Only localhost is allowed.")
            return False
        return True

    def do_GET(self):
        if not self.check_origin(): return

        if self.path == '/api/load-projects':
            self.handle_load_projects()
        else:
            # Slouží jako klasický static file server pro zbytek požadavků (index.html apod.)
            super().do_GET()

    def do_POST(self):
        if not self.check_origin(): return
        
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty payload")
            return
            
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(post_data)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON data")
            return

        if self.path == '/api/save-project':
            self.handle_save_project(data)
        elif self.path == '/api/upload-image':
            self.handle_upload_image(data)
        elif self.path == '/api/delete-project':
            self.handle_delete_project(data)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_save_project(self, data):
        # Očekává formát: { "project": { id: "proj_123", name: "Hra", ... } }
        project_data = data.get('project')
        if not project_data or 'id' not in project_data:
            self.send_error(400, "Missing project ID")
            return
            
        proj_id = project_data['id']
        # Sanitizace ID pro bezpečný název souboru
        safe_id = "".join([c for c in proj_id if c.isalnum() or c in ('_', '-')])
        filepath = os.path.join(PROJECTS_DIR, f"{safe_id}.json")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(project_data, f, ensure_ascii=False, indent=2)
            
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

    def handle_delete_project(self, data):
        proj_id = data.get('id')
        if not proj_id:
            self.send_error(400, "Missing project ID")
            return
        safe_id = "".join([c for c in proj_id if c.isalnum() or c in ('_', '-')])
        filepath = os.path.join(PROJECTS_DIR, f"{safe_id}.json")
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
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

        # Rozdělení na prefix a obsah
        if ',' in raw_base64:
            prefix, img_data = raw_base64.split(',', 1)
        else:
            img_data = raw_base64
            
        # Získání přípony
        ext = os.path.splitext(orig_filename)[1]
        if not ext: ext = ".png"
        
        # Unikátní jméno bezpečné proti path traversal
        unique_name = f"img_{int(time.time())}{ext}"
        filepath = os.path.join(IMAGES_DIR, unique_name)
        
        try:
            with open(filepath, 'wb') as f:
                f.write(base64.b64decode(img_data))
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            # Vracíme lokální relativní web adresu, tedy odkud to pak přečte prohlížeč díky `do_GET`
            self.wfile.write(json.dumps({"url": f"Images/{unique_name}"}).encode('utf-8'))
        except Exception as e:
            self.send_error(500, f"Failed to block writing image: {str(e)}")

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), PlanerRequestHandler) as httpd:
        print(f"Server běží vzorně a bezpečně (pouze lokální spojení) na portu {PORT}")
        httpd.serve_forever()

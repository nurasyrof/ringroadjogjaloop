# Dev server that tells the browser not to cache, so edits show up on reload.
#   python3 tools/serve.py [port]
import http.server, os, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 5180))
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()

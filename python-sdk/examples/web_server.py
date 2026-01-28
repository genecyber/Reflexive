#!/usr/bin/env python3
"""
AI-powered web server example using Reflexive

This demonstrates using r.chat() to generate dynamic content inline.
Run with: reflexive --debug web_server.py
"""

import reflexive
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Create Reflexive instance
r = reflexive.make_reflexive()

# Track stats
request_count = 0
story_count = 0


class StoryHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Use reflexive logging instead of default
        r.log('info', f'{self.address_string()} - {format % args}')

    def do_GET(self):
        global request_count, story_count

        request_count += 1
        r.set_state('requests.total', request_count)

        parsed = urlparse(self.path)

        if parsed.path == '/':
            # Home page
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()

            html = f"""
            <html>
            <head><title>AI Story Generator</title></head>
            <body style="font-family: sans-serif; max-width: 800px; margin: 50px auto;">
                <h1>🤖 AI Story Generator</h1>
                <p>Powered by Reflexive + Claude</p>
                <p>Try: <a href="/story?topic=space+adventure">/story?topic=space+adventure</a></p>
                <p>Or: <a href="/story?topic=mystery+detective">/story?topic=mystery+detective</a></p>
                <hr>
                <p><b>Stats:</b> {request_count} requests, {story_count} stories generated</p>
            </body>
            </html>
            """
            self.wfile.write(html.encode('utf-8'))

        elif parsed.path == '/story':
            # Generate AI story
            query_params = parse_qs(parsed.query)
            topic = query_params.get('topic', ['random'])[0]

            story_count += 1
            r.set_state('stories.generated', story_count)

            # Use AI inline to generate the story!
            r.log('info', f'Generating story about: {topic}')
            story = r.chat(f'Write a very short (3-4 sentences) story about: {topic}')

            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()

            html = f"""
            <html>
            <head><title>Story: {topic}</title></head>
            <body style="font-family: sans-serif; max-width: 800px; margin: 50px auto;">
                <h1>📖 {topic.title()}</h1>
                <div style="background: #f0f0f0; padding: 20px; border-radius: 8px; line-height: 1.6;">
                    {story}
                </div>
                <p><a href="/">← Back to home</a></p>
            </body>
            </html>
            """
            self.wfile.write(html.encode('utf-8'))

        else:
            # 404
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Not Found')


if __name__ == '__main__':
    port = 8080
    server = HTTPServer(('', port), StoryHandler)

    print(f"🚀 AI Story Server running on http://localhost:{port}")
    print(f"📊 Run with: reflexive --debug web_server.py")
    print(f"   to get full AI introspection capabilities!")
    print()

    r.log('system', f'Server started on port {port}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        r.log('system', 'Server stopped')
        server.shutdown()

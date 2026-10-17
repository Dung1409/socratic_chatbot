"""Public URL generation from operator configuration, never request headers."""
from urllib.parse import urlsplit


class PublicOriginMiddleware:
    def __init__(self, app, origin):
        self.app = app
        parsed = urlsplit(origin)
        self.scheme = parsed.scheme
        self.host = parsed.netloc.encode("ascii")
        self.server = (parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"}:
            scope["scheme"] = ("wss" if self.scheme == "https" else "ws") if scope["type"] == "websocket" else self.scheme
            scope["server"] = self.server
            scope["headers"] = [(key, value) for key, value in scope["headers"] if key.lower() != b"host"]
            scope["headers"].append((b"host", self.host))
        await self.app(scope, receive, send)

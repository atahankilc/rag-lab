"""Print a signed JWT (HS256) for PostgREST's write role, using LAB_JWT_SECRET from .env.

PostgREST reads the "role" claim and switches to that database role for the request.
Usage: make token  ->  curl -H "Authorization: Bearer $(make -s token)" ...
"""
import base64
import hashlib
import hmac
import json
import pathlib
import sys
import time


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def env_value(key: str) -> str:
    for line in pathlib.Path(".env").read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"{key} is missing from .env")


secret = env_value("LAB_JWT_SECRET").encode()
header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
claims = b64(json.dumps({"role": "web_writer", "exp": int(time.time()) + 12 * 3600}).encode())
signature = b64(hmac.new(secret, f"{header}.{claims}".encode(), hashlib.sha256).digest())
print(f"{header}.{claims}.{signature}")

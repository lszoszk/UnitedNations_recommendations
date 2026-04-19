#!/usr/bin/env python3
"""
notify_email.py — tiny direct-to-MX email sender for UHRI cron notifications.

No MTA needed on the VM. Resolves the recipient's MX record, connects on
port 25, optional STARTTLS, sends a plain-text message. Relies on the VM
being able to reach port 25 outbound.

Usage:
    notify_email.py <to_addr> <subject> <body>

Exit codes:
    0  delivered to at least one MX host
    1  all MX attempts failed
"""
from __future__ import annotations

import email.utils
import socket
import smtplib
import subprocess
import sys
import time
from email.message import EmailMessage


FROM_ADDR = "uhri-refresh@150.254.115.204.nip.io"
FROM_NAME = "UHRI Dashboard · monthly refresh"
TIMEOUT_S = 30


def resolve_mx(domain: str) -> list[str]:
    """Return MX hosts sorted by priority (lowest preference first)."""
    try:
        raw = subprocess.check_output(
            ["dig", "+short", "MX", domain], timeout=15
        ).decode().strip()
    except Exception as exc:
        print(f"[notify] MX lookup failed: {exc}", file=sys.stderr)
        return []
    hosts = []
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit():
            hosts.append((int(parts[0]), parts[1].rstrip(".")))
    hosts.sort()
    return [h for _, h in hosts]


def build_message(to_addr: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = email.utils.formataddr((FROM_NAME, FROM_ADDR))
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=False)
    msg["Message-ID"] = email.utils.make_msgid(domain="150.254.115.204.nip.io")
    msg["X-UHRI-Refresh"] = "1"
    msg.set_content(body, charset="utf-8")
    return msg


def send_via_host(host: str, msg: EmailMessage) -> tuple[bool, str]:
    """Try sending via one MX host. Returns (success, log)."""
    try:
        # Many MTAs (e.g. AMU's) reject HELO with a non-FQDN name. Force a
        # forward-resolvable FQDN even if socket.getfqdn() returns the short
        # hostname. nip.io resolves "a-b-c-d.nip.io" back to a.b.c.d.
        fqdn = socket.getfqdn()
        if "." not in fqdn:
            fqdn = "uhri-refresh.150-254-115-204.nip.io"
        with smtplib.SMTP(host, 25, timeout=TIMEOUT_S, local_hostname=fqdn) as s:
            s.ehlo_or_helo_if_needed()
            # Try STARTTLS opportunistically
            try:
                if s.has_extn("starttls"):
                    s.starttls()
                    s.ehlo()
            except Exception as e:
                # Continue in plaintext if TLS fails — we don't carry secrets
                pass
            s.send_message(msg)
        return True, f"delivered via {host}"
    except Exception as exc:
        return False, f"{host}: {type(exc).__name__}: {exc}"


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: notify_email.py <to> <subject> <body>", file=sys.stderr)
        return 2

    to_addr, subject, body = sys.argv[1:4]
    domain = to_addr.split("@", 1)[1] if "@" in to_addr else ""
    if not domain:
        print(f"[notify] invalid address {to_addr!r}", file=sys.stderr)
        return 1

    hosts = resolve_mx(domain)
    if not hosts:
        print(f"[notify] no MX records for {domain}", file=sys.stderr)
        return 1

    msg = build_message(to_addr, subject, body)

    last_error = ""
    for host in hosts:
        ok, info = send_via_host(host, msg)
        print(f"[notify] {info}")
        if ok:
            return 0
        last_error = info
        time.sleep(2)

    print(f"[notify] all MX attempts failed: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

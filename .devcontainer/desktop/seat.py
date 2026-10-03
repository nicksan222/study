#!/usr/bin/env python3
"""Keep a virtual pointer plugged into the headless desktop's seat (`just desktop`).

A headless sway has no input devices, so its seat has no pointer and apps hold no
wl_pointer. Tools like wlrctl plug one in only while they run, and the app binds it too
late: their first click is lost. While this runs, the seat always has a pointer, and
`swaymsg seat - cursor set|press|release` reaches the app. It speaks the Wayland wire
protocol directly, so it needs nothing beyond Python, and exits when sway does.
"""

import os
import socket
import struct

# Connect as a minimal Wayland client using the socket exported by desktop.env.
# Keeping this connection open keeps the virtual pointer object alive.
sock = socket.socket(socket.AF_UNIX)
sock.connect(os.path.join(os.environ["XDG_RUNTIME_DIR"], os.environ["WAYLAND_DISPLAY"]))


def send(obj, opcode, payload=b""):
    """Send one Wayland request using its object id, opcode, and aligned body."""
    sock.sendall(struct.pack("<II", obj, (8 + len(payload)) << 16 | opcode) + payload)


def string(text):
    """Encode a Wayland string: length-prefixed, NUL-terminated, 4-byte aligned."""
    data = text.encode() + b"\0"
    return struct.pack("<I", len(data)) + data + b"\0" * (-len(data) % 4)


def events():
    """Yield complete messages while retaining a partial socket read for later."""
    buf = b""
    while chunk := sock.recv(65536):
        buf += chunk
        while len(buf) >= 8:
            obj, size_op = struct.unpack_from("<II", buf)
            size = size_op >> 16
            if len(buf) < size:
                break
            yield obj, size_op & 0xFFFF, buf[8:size]
            buf = buf[size:]


# Object 1 is wl_display. Client-created object ids only need to be unique on
# this connection, so fixed ids keep this tiny protocol client easy to audit.
REGISTRY, SYNC, SEAT, MANAGER, POINTER = 2, 3, 4, 5, 6
# Ask for the registry, then use a sync callback as the boundary after the initial
# batch of advertised globals. We need only wl_seat and wlroots' pointer manager.
send(1, 1, struct.pack("<I", REGISTRY))  # wl_display.get_registry
send(1, 0, struct.pack("<I", SYNC))  # wl_display.sync
names = {}
stream = events()
for obj, opcode, body in stream:
    if obj == 1 and opcode == 0:
        raise SystemExit("wayland protocol error")
    if obj == REGISTRY and opcode == 0:  # wl_registry.global
        (name, length) = struct.unpack_from("<II", body)
        names[body[8 : 8 + length - 1].decode()] = name
    if obj == SYNC:
        break

manager = "zwlr_virtual_pointer_manager_v1"
if manager not in names or "wl_seat" not in names:
    raise SystemExit(f"the compositor offers no {manager}")
# Bind version 1 of both interfaces, then create a pointer associated with this
# seat. No motion requests are needed: swaymsg supplies motion and button events.
for interface, new_id in (("wl_seat", SEAT), (manager, MANAGER)):
    payload = (
        struct.pack("<I", names[interface])
        + string(interface)
        + struct.pack("<II", 1, new_id)
    )
    send(REGISTRY, 0, payload)
send(MANAGER, 0, struct.pack("<II", SEAT, POINTER))  # create_virtual_pointer(seat, id)
for _ in stream:  # hold the pointer until sway goes away
    pass

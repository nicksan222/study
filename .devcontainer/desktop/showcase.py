#!/usr/bin/env python3
"""Turn a desktop recording into a small PR attachment; never upload anything.

Keep the first 15 seconds, remove audio and metadata, and avoid upscaling. MP4 is
usually smaller and clearer; GIF is available for a short looping interaction.
Write through a temporary directory so a failed conversion leaves no broken output.
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_BYTES = 8_000_000


def convert(source, destination):
    """Encode with installed FFmpeg, then publish only a nonempty, bounded file."""
    source = source.resolve()
    destination = destination.resolve()
    if not source.is_file():
        raise ValueError(f"recording not found: {source}")
    if destination.exists():
        raise ValueError(f"output already exists; choose a new name: {destination}")
    if destination.suffix not in {".mp4", ".gif"}:
        raise ValueError("output must end in .mp4 or .gif")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="showcase-", dir=destination.parent) as temporary:
        output = Path(temporary) / destination.name
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
            "-i", str(source), "-t", "15", "-an", "-map_metadata", "-1",
        ]
        if destination.suffix == ".mp4":
            command += [
                "-vf", "fps=12,scale=min(1280\\,iw):-2",
                "-c:v", "libx264", "-crf", "28", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
            ]
        else:
            # A palette made from this clip gives readable text with fewer colors.
            command += [
                "-filter_complex",
                "fps=10,scale=min(960\\,iw):-2:flags=lanczos,split[a][b];"
                "[a]palettegen=max_colors=128[p];[b][p]paletteuse",
                "-loop", "0",
            ]
        subprocess.run([*command, str(output)], check=True, timeout=120)
        size = output.stat().st_size
        if size == 0 or size > MAX_BYTES:
            raise ValueError("showcase must be 1–8,000,000 bytes; shorten the clip or use MP4")
        output.rename(destination)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    try:
        output = convert(options.input, options.output)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"showcase: {error}", file=sys.stderr)
        return 1
    print(f"Prepared {output} ({output.stat().st_size:,} bytes). Inspect it before attaching.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

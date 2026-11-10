#!/usr/bin/env python3
"""Build the two placeholder far-end videos from media/cues.json.

Only needed until the real videos are filmed. Requires an ffmpeg build with
the flite (speech) and drawtext filters. Run from the repository root:

    python3 tools/make_placeholders.py
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
VIDEOS = {
    "video1": ("far-end-1.webm", "0x1d3557", "PLACEHOLDER  |  Far-end video 1: demo instructions", "kal16"),
    "video2": ("far-end-2.webm", "0x3d2c5c", "PLACEHOLDER  |  Far-end video 2: realistic meeting", "slt"),
}


def run(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(out.stdout)


def build(key, spec, tmp):
    filename, colour, title, voice = VIDEOS[key]
    cues, total = spec["cues"], spec["duration"]

    def textfile(name, text):
        path = tmp / f"{key}-{name}.txt"
        path.write_text(text)
        return path

    # Speech: one clip per cue, delayed to the start of its window.
    inputs, delays = [], []
    for i, cue in enumerate(cues):
        wav = tmp / f"{key}-{i}.wav"
        run("-f", "lavfi", "-i", f"flite=textfile={textfile(f'say{i}', cue[key])}:voice={voice}", str(wav))
        length, window = duration(wav), cue["end"] - cue["start"]
        if length > window:
            sys.exit(f"{key} cue {i} is {length:.1f}s of speech but its window is only {window:.1f}s")
        inputs += ["-i", str(wav)]
        delays.append(f"[{i + 1}:a]adelay={int(cue['start'] * 1000)}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(cues)))
    audio = ";".join(delays) + f";{mix}amix=inputs={len(cues)}:normalize=0,apad,atrim=0:{total}[aout]"

    # Picture: title, clock, the current line as a caption, and a prompt in the gaps.
    def draw(path, size, y, enable=None, colour="white"):
        f = f"drawtext=fontfile={FONT}:textfile={path}:fontsize={size}:fontcolor={colour}:x=(w-text_w)/2:y={y}:line_spacing=14"
        return f + (f":enable='{enable}'" if enable else "")

    layers = [
        draw(textfile("title", title), 26, 50, colour="white@0.7"),
        draw(textfile("clock", "%{pts:hms}"), 24, "h-70", colour="white@0.6"),
    ]
    gap_text = "Your turn. The room answers now." if key == "video1" else "(listening to the room)"
    previous_end = 0
    for i, cue in enumerate(cues):
        caption = textfile(f"cap{i}", textwrap.fill(cue[key].replace("B S S", "BSS"), 38))
        layers.append(draw(caption, 44, "(h-text_h)/2", f"between(t,{cue['start']},{cue['end']})"))
        if cue["start"] > previous_end + 1:
            layers.append(draw(textfile("gap", gap_text), 40, "(h-text_h)/2",
                               f"between(t,{previous_end},{cue['start']})", "0xffd166"))
        previous_end = cue["end"]
    video = f"[0:v]{','.join(layers)}[vout]"

    out = ROOT / "media" / filename
    run("-f", "lavfi", "-i", f"color=c={colour}:s=1280x720:r=30:d={total}", *inputs,
        "-filter_complex", f"{video};{audio}", "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", "-g", "60", "-row-mt", "1",
        "-c:a", "libopus", "-b:a", "64k", "-t", str(total), str(out))
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


def main():
    spec = json.loads((ROOT / "media" / "cues.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        for key in VIDEOS:
            build(key, spec, pathlib.Path(tmp))


if __name__ == "__main__":
    main()

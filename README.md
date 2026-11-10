# BSS Room Demo

A simulated one-to-one video call for demonstrating BSS conferencing bars without anyone on the far end and without internet.

1. **Setup** – the app finds the bar's camera, microphone and speaker and shows a preview and mic level.
2. **Live call** – a pre-recorded "far end" (`media/far-end-1.webm`) talks to the room while the bar's camera shows as the small self-view. The room is recorded.
3. **Playback** – roles reverse. The room's recording plays full screen as the far end, and a second pre-recorded video (`media/far-end-2.webm`) plays in the small picture.

The recording stays in the browser's memory and is discarded when the demo is restarted or the app is closed.

## Running it

It is a static web app with no build step and no dependencies. Camera access needs HTTPS or `localhost`.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge.

For salespeople: host the folder on any HTTPS static host (for example GitHub Pages), open it once in Chrome or Edge, and choose **Install** from the address bar. It then opens from a desktop icon, full screen, and works offline.

Add `?bar=Name` to the address to test with other hardware, e.g. `?bar=Logitech`. The default looks for "BSS" in the device name.

## Replacing the placeholder videos

The two videos in `media/` are computer-voiced placeholders. Replace them with real footage using the same file names (WebM with VP9 or AV1 video and Opus audio), then change `VERSION` in `sw.js` so installed laptops pick up the new files.

Both videos must follow one shared timeline: the presenter speaks in the same time windows in each, and the gaps are where the room answers. `media/cues.json` holds the placeholder timeline and scripts, and `python3 tools/make_placeholders.py` rebuilds the placeholders from it (needs ffmpeg with the flite and drawtext filters).

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app. Settings are at the top of `app.js`, colours at the top of `style.css`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline use and installing as an app. |
| `media/` | Far-end videos and their shared cue sheet. |
| `tools/make_placeholders.py` | Generates the placeholder videos. |

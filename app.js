'use strict';

// ---------------------------------------------------------------------------
// Settings. Add ?bar=Name to the address to test with a different device,
// for example ?bar=Logitech.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const CONFIG = {
  barName: new RegExp(params.get('bar') || 'BSS', 'i'),
  farEnd1: 'media/far-end-1.webm', // plays during the live call
  farEnd2: 'media/far-end-2.webm', // plays alongside the room's recording
  farEndName: 'Alex',
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  // The browser's own processing is switched off so the room hears the bar, not the laptop.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  videoBitsPerSecond: 8_000_000,
  audioBitsPerSecond: 128_000,
};

const $ = (id) => document.getElementById(id);
const screens = ['setup', 'call', 'between', 'done'];
const main = $('mainVideo');
const pip = $('pipVideo');
const canPickSpeaker = 'setSinkId' in HTMLMediaElement.prototype;

let stream = null;
let recorder = null;
let chunks = [];
let recordingUrl = null;
let phase = 'setup'; // setup | live | between | playback | done
let targetScreen = null;
let wakeLock = null;

function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
async function openStream(camId, micId) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { ...CONFIG.video, ...(camId && { deviceId: { exact: camId } }) },
    audio: { ...CONFIG.audio, ...(micId && { deviceId: { exact: micId } }) },
  });
  $('preview').srcObject = stream;
  startMeter();
}

function currentIds() {
  return {
    cam: stream?.getVideoTracks()[0]?.getSettings().deviceId,
    mic: stream?.getAudioTracks()[0]?.getSettings().deviceId,
  };
}

function fillSelect(select, devices, selectedId) {
  select.replaceChildren(...devices.map((d, i) => new Option(d.label || `Device ${i + 1}`, d.deviceId)));
  if (devices.some((d) => d.deviceId === selectedId)) select.value = selectedId;
}

async function setup() {
  const status = $('status');
  try {
    await openStream();
    let devices = await navigator.mediaDevices.enumerateDevices();
    const find = (kind) => devices.find((d) => d.kind === kind && CONFIG.barName.test(d.label));
    const barCam = find('videoinput');
    const barMic = find('audioinput');
    const barSpk = find('audiooutput');

    // If the bar is plugged in but was not the default device, switch to it.
    let { cam, mic } = currentIds();
    if ((barCam && barCam.deviceId !== cam) || (barMic && barMic.deviceId !== mic)) {
      await openStream(barCam?.deviceId || cam, barMic?.deviceId || mic);
      ({ cam, mic } = currentIds());
    }

    const of = (kind) => devices.filter((d) => d.kind === kind);
    fillSelect($('camSelect'), of('videoinput'), cam);
    fillSelect($('micSelect'), of('audioinput'), mic);
    const speakers = of('audiooutput');
    $('speakerRow').hidden = !canPickSpeaker || speakers.length === 0;
    fillSelect($('spkSelect'), speakers, barSpk?.deviceId || $('spkSelect').value || 'default');

    if (barCam && barMic) {
      status.textContent = 'BSS bar connected';
      status.className = 'status good';
    } else {
      status.textContent = 'BSS bar not found. Using the devices below.';
      status.className = 'status warn';
    }
    $('startBtn').disabled = false;
  } catch (err) {
    stream = null;
    $('startBtn').disabled = true;
    status.className = 'status bad';
    status.textContent = err.name === 'NotAllowedError'
      ? 'Camera and microphone access is blocked. Allow it in the address bar, then reload.'
      : 'No camera or microphone found. Plug in the bar and it will appear here.';
  }
}

async function switchDevice() {
  try {
    await openStream($('camSelect').value, $('micSelect').value);
  } catch {
    setup();
  }
}

async function applySpeaker(...elements) {
  const id = $('spkSelect').value;
  if (!canPickSpeaker || !id) return;
  await Promise.all(elements.map((el) => el.setSinkId(id).catch(() => {})));
}

// Microphone level meter on the setup screen.
let audioCtx = null;
let meterSource = null;
let analyser = null;
function startMeter() {
  audioCtx ??= new AudioContext();
  meterSource?.disconnect();
  analyser ??= audioCtx.createAnalyser();
  meterSource = audioCtx.createMediaStreamSource(stream);
  meterSource.connect(analyser);
}
function drawMeter() {
  if (analyser && phase === 'setup') {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    $('meterFill').style.width = `${Math.min(100, rms * 400)}%`;
  }
  requestAnimationFrame(drawMeter);
}

// Short chime through the chosen speaker.
async function testSpeaker() {
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  const gain = audioCtx.createGain();
  gain.connect(dest);
  const now = audioCtx.currentTime;
  [523, 659, 784].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.3);
  });
  gain.gain.setValueAtTime(0.25, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.9);
  const el = new Audio();
  el.srcObject = dest.stream;
  await applySpeaker(el);
  await el.play();
  setTimeout(() => { el.srcObject = null; }, 1200);
}

// Optional: put the call on a second display (the TV) while the laptop keeps the window.
async function pickDisplay() {
  try {
    const details = await window.getScreenDetails();
    const others = details.screens.filter((s) => s !== details.currentScreen);
    if (!others.length) return;
    targetScreen = others[(others.indexOf(targetScreen) + 1) % others.length];
    $('displayBtn').textContent = `Call will show on: ${targetScreen.label || 'second display'}`;
  } catch {
    $('displayBtn').textContent = 'Display access was not allowed';
  }
}

async function enterFullscreen() {
  if (document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen(targetScreen ? { screen: targetScreen } : undefined);
  } catch { /* the demo still works in a window */ }
}

// ---------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------
function setPhase(next) {
  phase = next;
  const live = next === 'live';
  $('phaseBadge').textContent = live ? 'Recording' : 'Playback';
  $('phaseBadge').classList.toggle('rec', live);
  $('mainLabel').textContent = live ? CONFIG.farEndName : 'Your room, as the other side sees and hears it';
  $('pipLabel').textContent = live ? 'You' : CONFIG.farEndName;
  pip.classList.toggle('mirror', live);
  $('timer').textContent = '00:00';
}

function recorderOptions() {
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t));
  return { mimeType, videoBitsPerSecond: CONFIG.videoBitsPerSecond, audioBitsPerSecond: CONFIG.audioBitsPerSecond };
}

const ready = (video) => new Promise((resolve) => {
  if (video.readyState >= 3) resolve();
  else video.addEventListener('canplay', resolve, { once: true });
});

// Step 1: the far end is the pre-recorded video, the small picture is the live bar camera.
async function startCall() {
  await enterFullscreen();
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
  show('call');
  setPhase('live');

  pip.srcObject = stream;
  pip.muted = true;
  pip.play();

  chunks = [];
  recorder = new MediaRecorder(stream, recorderOptions());
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  main.src = CONFIG.farEnd1;
  main.muted = false;
  await applySpeaker(main, pip);
  // Recording starts on the far end's first frame so the two stay on one timeline.
  main.addEventListener('playing', () => { if (recorder.state === 'inactive') recorder.start(1000); }, { once: true });
  main.onended = endCall;
  await main.play();
}

async function endCall() {
  if (phase !== 'live') return;
  phase = 'between';
  main.onended = null;
  main.pause();
  if (recorder.state === 'inactive') return restart(); // ended before anything was recorded
  await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
  recordingUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
  chunks = [];
  pip.srcObject = null;
  show('between');
}

// Step 2: roles reversed. The room's recording is the far end, the second video is the small picture.
async function startPlayback() {
  await enterFullscreen();
  show('call');
  setPhase('playback');

  pip.srcObject = null;
  pip.src = CONFIG.farEnd2;
  pip.muted = false;
  main.src = recordingUrl;
  main.muted = false;
  await applySpeaker(main, pip);
  await Promise.all([ready(main), ready(pip)]);
  main.onended = pip.onended = endPlayback;
  await Promise.all([main.play(), pip.play()]);
}

function endPlayback() {
  if (phase !== 'playback') return;
  phase = 'done';
  main.onended = pip.onended = null;
  main.pause();
  pip.pause();
  show('done');
}

function restart() {
  phase = 'setup';
  for (const v of [main, pip]) {
    v.onended = null;
    v.pause();
    v.srcObject = null;
    v.removeAttribute('src');
    v.load();
  }
  if (recordingUrl) URL.revokeObjectURL(recordingUrl); // the recording is gone for good
  recordingUrl = null;
  wakeLock?.release();
  if (document.fullscreenElement) document.exitFullscreen();
  show('setup');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
$('startBtn').onclick = startCall;
$('playbackBtn').onclick = startPlayback;
$('againBtn').onclick = startPlayback;
$('endBtn').onclick = () => (phase === 'live' ? endCall() : endPlayback());
document.querySelectorAll('.restart').forEach((b) => { b.onclick = restart; });
$('camSelect').onchange = switchDevice;
$('micSelect').onchange = switchDevice;
$('testSpeaker').onclick = testSpeaker;
$('displayBtn').onclick = pickDisplay;
$('displayBtn').hidden = !('getScreenDetails' in window && screen.isExtended);

main.ontimeupdate = () => {
  const s = Math.floor(main.currentTime);
  $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Hide the pointer and dim the controls when nobody is touching the mouse.
let idleTimer;
$('call').onmousemove = () => {
  $('call').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => $('call').classList.add('idle'), 2500);
};

document.addEventListener('pointerdown', () => audioCtx?.resume());
navigator.mediaDevices?.addEventListener('devicechange', () => { if (phase === 'setup') setup(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
  setup();
  drawMeter();
} else {
  $('status').className = 'status bad';
  $('status').textContent = 'This browser cannot run the demo. Open it in Chrome or Edge.';
}

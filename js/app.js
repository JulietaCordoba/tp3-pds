const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const rateBtn = document.getElementById('rateBtn');
const rateInput = document.getElementById('rateInput');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');

const rLast = document.getElementById('rLast');
const rMin = document.getElementById('rMin');
const rMax = document.getElementById('rMax');
const rVpp = document.getElementById('rVpp');
const rCount = document.getElementById('rCount');

const TIME_WINDOW_S = 0.15;
let currentSampleRate = 1000;
function getMaxPoints() {
  return Math.max(20, Math.round(currentSampleRate * TIME_WINDOW_S));
}

let buffer = [];
let totalCount = 0;
let port, reader;

// ---------- FFT ----------
const FFT_SIZE = 256;
let fftBuffer = [];
const spectrumCanvas = document.getElementById('spectrum');
const sctx = spectrumCanvas.getContext('2d');

function resizeSpectrum() {
  spectrumCanvas.width = spectrumCanvas.clientWidth * devicePixelRatio;
  spectrumCanvas.height = spectrumCanvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resizeSpectrum);
resizeSpectrum();

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len / 2;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe; curIm = nextIm;
      }
    }
  }
}

function processFFTSample(val) {
  fftBuffer.push(val);
  if (fftBuffer.length >= FFT_SIZE) {
    computeFFT(fftBuffer);
    fftBuffer = [];
  }
}

function computeFFT(samples) {
  const n = FFT_SIZE;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const re = new Array(n);
  const im = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    re[i] = (samples[i] - mean) * hann;
  }
  fft(re, im);

  const half = n / 2;
  const mags = new Array(half);
  for (let k = 0; k < half; k++) {
    mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * (4 / n);
  }

  const freqRes = currentSampleRate / n;
  const peaks = findPeaks(mags, 3, 3);
  updateHarmonics(peaks, freqRes);
  drawSpectrum(mags, peaks);
}

function findPeaks(mags, count, minSeparation) {
  const candidates = mags.map((m, i) => ({ i, m })).filter(p => p.i > 0);
  candidates.sort((a, b) => b.m - a.m);
  const peaks = [];
  for (const c of candidates) {
    if (peaks.length >= count) break;
    if (peaks.every(p => Math.abs(p.i - c.i) >= minSeparation)) {
      peaks.push(c);
    }
  }
  peaks.sort((a, b) => a.i - b.i);
  return peaks;
}

function updateHarmonics(peaks, freqRes) {
  const boxes = [document.getElementById('h1'), document.getElementById('h2'), document.getElementById('h3')];
  boxes.forEach((box, idx) => {
    if (peaks[idx]) {
      const freq = (peaks[idx].i * freqRes).toFixed(1);
      const amp = peaks[idx].m.toFixed(1);
      box.textContent = freq + ' Hz · A=' + amp;
    } else {
      box.textContent = '—';
    }
  });
}

function drawSpectrum(mags, peaks) {
  const w = spectrumCanvas.width, h = spectrumCanvas.height;
  sctx.clearRect(0, 0, w, h);
  const maxMag = Math.max(...mags, 1);
  const barW = w / mags.length;
  sctx.fillStyle = '#39ff6a';
  mags.forEach((m, i) => {
    const barH = (m / maxMag) * h;
    sctx.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);
  });
  sctx.fillStyle = '#ffb000';
  peaks.forEach(p => {
    const x = p.i * barW;
    const barH = (p.m / maxMag) * h;
    sctx.fillRect(x, h - barH, Math.max(2, barW), barH);
  });
}
// ---------- fin FFT ----------

// ---------- Filtros digitales ----------
let filterType = 'none';
let fcLow = 20;
let fcHigh = 100;

let lpState = 0;
let hpState = { y: 0, xPrev: 0 };
let bpHpState = { y: 0, xPrev: 0 };
let bpLpState = 0;
let filteredBuffer = [];

const filteredCanvas = document.getElementById('filtered');
const fctx = filteredCanvas.getContext('2d');

function resizeFiltered() {
  filteredCanvas.width = filteredCanvas.clientWidth * devicePixelRatio;
  filteredCanvas.height = filteredCanvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resizeFiltered);
resizeFiltered();

function lowpassStep(x, fc, prevY, fs) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const alpha = dt / (RC + dt);
  return prevY + alpha * (x - prevY);
}

function highpassStep(x, fc, state, fs) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const alpha = RC / (RC + dt);
  const y = alpha * (state.y + x - state.xPrev);
  state.xPrev = x;
  state.y = y;
  return y;
}

function applyFilterSample(x) {
  const fs = currentSampleRate;
  let y = x;
  if (filterType === 'lowpass') {
    y = lowpassStep(x, fcLow, lpState, fs);
    lpState = y;
  } else if (filterType === 'highpass') {
    y = highpassStep(x, fcLow, hpState, fs);
  } else if (filterType === 'bandpass') {
    const hp = highpassStep(x, fcLow, bpHpState, fs);
    y = lowpassStep(hp, fcHigh, bpLpState, fs);
    bpLpState = y;
  }
  return y;
}

function resetFilters() {
  lpState = 0;
  hpState = { y: 0, xPrev: 0 };
  bpHpState = { y: 0, xPrev: 0 };
  bpLpState = 0;
  filteredBuffer = [];
}

function drawFiltered() {
  const w = filteredCanvas.width, h = filteredCanvas.height;
  fctx.clearRect(0, 0, w, h);
  fctx.strokeStyle = '#1a3a1a';
  fctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = (w / 10) * i;
    fctx.beginPath(); fctx.moveTo(x, 0); fctx.lineTo(x, h); fctx.stroke();
  }
  const maxPoints = getMaxPoints();
  if (filteredBuffer.length > 1) {
    fctx.strokeStyle = '#ffb000';
    fctx.lineWidth = 1.5 * devicePixelRatio;
    fctx.beginPath();
    filteredBuffer.forEach((val, i) => {
      const x = (i / (maxPoints - 1)) * w;
      const y = h - ((val + 2048) / 4095) * h;
      if (i === 0) fctx.moveTo(x, y); else fctx.lineTo(x, y);
    });
    fctx.stroke();
  }
  requestAnimationFrame(drawFiltered);
}
requestAnimationFrame(drawFiltered);

const filterTypeSel = document.getElementById('filterType');
const fcLowLabel = document.getElementById('fcLowLabel');
const fcLowInput = document.getElementById('fcLowInput');
const fcHighLabel = document.getElementById('fcHighLabel');
const fcHighInput = document.getElementById('fcHighInput');

filterTypeSel.addEventListener('change', () => {
  const t = filterTypeSel.value;
  if (t === 'bandpass') {
    fcLowLabel.textContent = 'F. corte inferior (Hz):';
    fcHighLabel.style.display = '';
    fcHighInput.style.display = '';
  } else {
    fcLowLabel.textContent = 'Frecuencia de corte (Hz):';
    fcHighLabel.style.display = 'none';
    fcHighInput.style.display = 'none';
  }
});

document.getElementById('filterBtn').addEventListener('click', () => {
  filterType = filterTypeSel.value;
  fcLow = parseFloat(fcLowInput.value) || 20;
  fcHigh = parseFloat(fcHighInput.value) || 100;
  resetFilters();
  log('Filtro aplicado: ' + filterType +
      (filterType === 'bandpass' ? ` (${fcLow}Hz - ${fcHigh}Hz)` :
       filterType !== 'none' ? ` (${fcLow}Hz)` : ''));
});
// ---------- fin filtros ----------

function log(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
}

function resizeCanvas() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawGrid(w, h) {
  ctx.strokeStyle = '#1a3a1a';
  ctx.lineWidth = 1;
  const cols = 10, rows = 8;
  for (let i = 0; i <= cols; i++) {
    const x = (w / cols) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 0; i <= rows; i++) {
    const y = (h / rows) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawGrid(w, h);

  const maxPoints = getMaxPoints();
  if (buffer.length > 1) {
    ctx.strokeStyle = '#39ff6a';
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();
    buffer.forEach((val, i) => {
      const x = (i / (maxPoints - 1)) * w;
      const y = h - (val / 4095) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function updateReadouts(val) {
  totalCount++;
  rLast.textContent = val;
  rCount.textContent = totalCount;
  if (buffer.length > 0) {
    const min = Math.min(...buffer);
    const max = Math.max(...buffer);
    rMin.textContent = min;
    rMax.textContent = max;
    rVpp.textContent = (max - min);
  }
}

function handleLine(line) {
  line = line.trim();
  if (!line) return;

  const rateMatch = line.match(/Frecuencia de muestreo:\s*(\d+)/);
  if (rateMatch) {
    currentSampleRate = parseInt(rateMatch[1], 10);
    log(line);
    return;
  }

  if (/^\d+$/.test(line)) {
    const val = parseInt(line, 10);
    buffer.push(val);
    const maxPoints = getMaxPoints();
    if (buffer.length > maxPoints) buffer.shift();
    updateReadouts(val);
    processFFTSample(val);

    const filteredVal = applyFilterSample(val - 2048);
    filteredBuffer.push(filteredVal);
    if (filteredBuffer.length > maxPoints) filteredBuffer.shift();
  } else {
    log(line);
  }
}

async function readLoop() {
  while (port.readable) {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable).catch(() => {});
    reader = textDecoder.readable.getReader();
    let lineBuffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        lines.forEach(handleLine);
      }
    } catch (err) {
      log('Error de lectura (' + err.message + '), reintentando...');
    } finally {
      reader.releaseLock();
    }
  }
}

async function sendCommand(cmd) {
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode(cmd));
  writer.releaseLock();
}

connectBtn.addEventListener('click', async () => {
  if (!('serial' in navigator)) {
    log('Este navegador no soporta Web Serial API. Usá Chrome o Edge.');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    statusDot.classList.add('on');
    statusText.textContent = 'Conectado';
    connectBtn.disabled = true;
    startBtn.disabled = false;
    stopBtn.disabled = false;
    rateBtn.disabled = false;
    readLoop();
    log('Conectado al ESP32.');
  } catch (err) {
    log('Error al conectar: ' + err.message);
  }
});

startBtn.addEventListener('click', () => {
  resetFilters();
  sendCommand('S');
});
stopBtn.addEventListener('click', () => sendCommand('P'));
rateBtn.addEventListener('click', () => sendCommand('F' + rateInput.value));
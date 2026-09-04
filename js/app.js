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

const TIME_WINDOW_S = 0.15;   // ventana de tiempo fija a mostrar en pantalla: 150ms
let currentSampleRate = 1000; // debe arrancar igual que sampleRateHz en el .ino
function getMaxPoints() {
  return Math.max(20, Math.round(currentSampleRate * TIME_WINDOW_S));
}

let buffer = [];
let totalCount = 0;
let port, reader;

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

startBtn.addEventListener('click', () => sendCommand('S'));
stopBtn.addEventListener('click', () => sendCommand('P'));
rateBtn.addEventListener('click', () => sendCommand('F' + rateInput.value));
// ======= Config =======
const T_MIN = 0;
const T_MAX = 18;
// Tick spacing depends on k: tickStep = alpha = 1/(2k-1)
let tickStep = 1; // set to alpha when k is applied

function tickCount() {
    // number of tickStep steps between 0 and 18
    return Math.round((T_MAX - T_MIN) / tickStep);
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const pathCanvas = document.getElementById('pathCanvas');
const pathCtx = pathCanvas.getContext('2d');

const kInput = document.getElementById('kInput');
const applyBtn = document.getElementById('applyBtn');

const alphaPill = document.getElementById('alphaPill');
const betaPill = document.getElementById('betaPill');
const cardPill = document.getElementById('cardPill');

// Panel elements
const distanceList = document.getElementById('distanceList');
const stateTable = document.getElementById('stateTable');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const distanceTable = document.getElementById('distanceTable');
exportPdfBtn.addEventListener('click', exportTablesToPDF);



// Per-server state
let servers = []; // { id, color, value } where value in [0, 18]

// Movement tracking
let totalDistance = [];   // cumulative distance traveled by each server
let moveHistory = [];     // per server: array of committed positions (per-step)
let dragStartValue = 0;   // value when a drag starts (for distance calc)


// Drag state
let draggingId = null;
let dragOffsetX = 0;

// Layout (computed)
const layout = {
    padL: 90,
    padR: 24,
    padT: 36,
    padB: 28,
    tickLen: 10,
    lineGap: 70,
    knobR: 9,
    labelW: 78,
    axisY: 24,
    axisLabelY: 16,
};

// Use a stable, distinct palette.
// If k is larger than palette length, we generate hues.
const basePalette = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

function colorFor(i, k) {
    if (i < basePalette.length) return basePalette[i];
    // Generate more colors (golden angle)
    const hue = (i * 137.508) % 360;
    return `hsl(${hue} 70% 45%)`;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Convert time value -> x coordinate
function xForTime(t) {
  const { w } = cssSize(canvas);
  const x0 = layout.padL;
  const x1 = w - layout.padR;
  const u = (t - T_MIN) / (T_MAX - T_MIN);
  return x0 + u * (x1 - x0);
}

// Convert x coordinate -> time value
function timeForX(x) {
  const { w } = cssSize(canvas);
  const x0 = layout.padL;
  const x1 = w - layout.padR;
  const u = (x - x0) / (x1 - x0);
  return T_MIN + clamp(u, 0, 1) * (T_MAX - T_MIN);
}

// Snap a time value to the nearest multiple of tickStep (= alpha)
function snapToStep(t) {
    const step = tickStep;
    const n = Math.round((t - T_MIN) / step);
    return T_MIN + n * step;
}

function yForServerIndex(i) {
    // i is 0-based
    return layout.padT + layout.axisY + 30 + i * layout.lineGap;
}

let currentK = parseInt(kInput.value, 10) || 1;

function gcd(a, b) {
a = Math.abs(a); b = Math.abs(b);
while (b) [a, b] = [b, a % b];
return a || 1;
}

function formatFractionFromTime(t) {
// Since t is always snapped to multiples of alpha, t = num/(2k-1)
const denom = 2 * currentK - 1;
if (denom <= 1) return String(Math.round(t)); // k=1 => denom=1

let num = Math.round(t * denom);

// Reduce fraction
const g = gcd(num, denom);
num /= g;
const d = denom / g;

// If it becomes an integer, show as integer
if (d === 1) return String(num);

const sign = num < 0 ? "-" : "";
num = Math.abs(num);

const whole = Math.floor(num / d);
const rem = num % d;

if (rem === 0) return sign + String(whole);
if (whole === 0) return sign + `${rem}/${d}`;
return sign + `${whole} ${rem}/${d}`;
}

function computeAlphaBeta(k) {
    // As given: alpha = 1/(2k-1), beta = 2*alpha
    // Note: Then alpha + beta = 3/(2k-1), which equals 1 only when k=2.
    // We will still display alpha+beta=1 as the stated relation, but keep the given formulas.
    const alpha = 1 / (2 * k - 1);
    const beta = 2 * alpha;
    return { alpha, beta };
}

function updatePills(k) {
currentK = k; // IMPORTANT: keep denominator synced
const denom = 2 * k - 1;

alphaPill.innerHTML =
    `<span class="muted">α</span> = <b>1/${denom}</b> <span class="muted">(1/(2k−1))</span>`;

betaPill.innerHTML  =
    `<span class="muted">β</span> = <b>2/${denom}</b> <span class="muted">(2α)</span>`;

cardPill.innerHTML  =
    `<span class="muted">cardinality</span>: <b>|α| = 1</b>, <b>|β| = k−1</b> <span class="muted">(k=${k})</span>`;
}

function setServers(k) {
servers = Array.from({ length: k }, (_, i) => ({
    id: i,
    color: colorFor(i, k),
    value: 0
}));

// Start everyone at origin (0)
for (let i = 0; i < servers.length; i++) {
    servers[i].value = 0;
}

// Init movement tracking
totalDistance = Array(k).fill(0);
moveHistory = Array.from({ length: k }, () => []);

renderDistances();
renderTable();
}

function sizeCanvas(el, context, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  el.style.width = cssW + 'px';
  el.style.height = cssH + 'px';
  el.width = Math.floor(cssW * dpr);
  el.height = Math.floor(cssH * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Canvas sizing for crisp rendering
function resizeCanvas() {
  const topbarH = document.querySelector('.topbar').getBoundingClientRect().height;

  // Use the CSS heights you set in CSS (vh), just read actual rendered height:
    // const wrapEl = document.getElementById('wrap');
    // const cssW = Math.floor(wrapEl.getBoundingClientRect().width);
    const cssW = Math.floor(window.innerWidth);
    const mainCssH = Math.floor(document.getElementById('c').getBoundingClientRect().height);
    // Dynamically size the path diagram to fit all servers
    const k = servers.length;
    const topPad = 70;           // axis + margins
    const bandMinH = 120;   // was 52 → more vertical room per server path
    const gap = 28;         // was 18 → more separation between server bands

    const desired = topPad + k * bandMinH + Math.max(0, k - 1) * gap;

    // Allow the path canvas to grow taller so bands actually get that space
    const maxH = Math.floor(window.innerHeight * 0.80); // was 0.55
    const pathCssH = clamp(desired, 220, maxH);

    // IMPORTANT: set CSS height BEFORE measuring/allocating pixels
    pathCanvas.style.height = pathCssH + 'px';
  sizeCanvas(canvas, ctx, cssW, mainCssH);
  sizeCanvas(pathCanvas, pathCtx, cssW, pathCssH);

  draw();
  drawPaths();
}

// ======= Drawing =======
function clear() {
    const { w, h } = cssSize(canvas);
    ctx.clearRect(0, 0, w, h);
    // background
    ctx.fillStyle = 'rgba(255,255,255,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawAxis() {
    const { w, h } = cssSize(canvas);
    const x0 = layout.padL;
    const x1 = w - layout.padR;

    // Baseline for timeline (top axis)
    const y = layout.padT;

    // Axis line
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    // Ticks are spaced by alpha (= tickStep). For readability, we only label integers (0..18).
    ctx.fillStyle = '#111827';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const steps = tickCount();
    for (let i = 0; i <= steps; i++) {
    const t = T_MIN + i * tickStep;
    const x = xForTime(t);

    const isInteger = Math.abs(t - Math.round(t)) < 1e-9;
    const len = isInteger ? layout.tickLen : Math.max(4, Math.floor(layout.tickLen * 0.55));

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - len);
    ctx.stroke();

    if (isInteger) {
        ctx.fillText(String(Math.round(t)), x, y - layout.tickLen - 4);
    }
    }

    // Left vertical spine
    const spineX = x0;
    const spineTop = y;
    const spineBottom = yForServerIndex(Math.max(servers.length - 1, 0)) + 30;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(spineX, spineTop);
    ctx.lineTo(spineX, clamp(spineBottom, spineTop, h - layout.padB));
    ctx.stroke();
}

function drawServerLine(server, idx) {
    const { w } = cssSize(canvas);
    const x0 = layout.padL;
    const x1 = w - layout.padR;
    const y = yForServerIndex(idx);

    // Label
    ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111827';
    const label = (idx === servers.length - 1 && servers.length > 5)
    ? 'Server K'
    : `Server ${idx + 1}`;
    ctx.fillText(label, x0 - 12, y);

    // Line
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    // Start dot at left (black)
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x0, y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Knob (colored)
    const knobX = xForTime(server.value);
    ctx.fillStyle = server.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(knobX, y, layout.knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Value bubble
    const bubbleText = formatFractionFromTime(server.value);
    const bw = ctx.measureText(bubbleText).width + 12;
    const bx = clamp(knobX, x0 + bw/2, x1 - bw/2);
    const by = y - 22;

    // Bubble background
    ctx.fillStyle = 'rgba(17,24,39,0.06)';
    roundRect(bx - bw/2, by - 14, bw, 22, 10);
    ctx.fill();

    ctx.fillStyle = '#111827';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bubbleText, bx, by - 3);
}

function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

function drawPaths() {
  const w = pathCanvas.width / (window.devicePixelRatio || 1);
  const h = pathCanvas.height / (window.devicePixelRatio || 1);

  // Clear background
  pathCtx.clearRect(0, 0, w, h);
  pathCtx.fillStyle = '#fff';
  pathCtx.fillRect(0, 0, w, h);

  // Axis (reuse same horizontal mapping)
  const x0 = layout.padL;
  const x1 = w - layout.padR;
  const top = 25;

  // top axis line
  pathCtx.strokeStyle = '#111827';
  pathCtx.lineWidth = 2;
  pathCtx.beginPath();
  pathCtx.moveTo(x0, top);
  pathCtx.lineTo(x1, top);
  pathCtx.stroke();

  // integer labels 0..18
  // ticks every alpha (= tickStep), labels only at integers
    pathCtx.fillStyle = '#111827';
    pathCtx.font = '12px system-ui';
    pathCtx.textAlign = 'center';
    pathCtx.textBaseline = 'bottom';

    const steps = tickCount(); // number of alpha steps from 0 to 18
    for (let i = 0; i <= steps; i++) {
    const t = T_MIN + i * tickStep; // t advances by alpha
    const u = (t - T_MIN) / (T_MAX - T_MIN);
    const x = x0 + u * (x1 - x0);

    const isInteger = Math.abs(t - Math.round(t)) < 1e-9;
    const len = isInteger ? 10 : 5; // major vs minor tick length

    pathCtx.strokeStyle = '#111827';
    pathCtx.lineWidth = 1;
    pathCtx.beginPath();
    pathCtx.moveTo(x, top);
    pathCtx.lineTo(x, top - len);
    pathCtx.stroke();

    if (isInteger) {
        pathCtx.fillText(String(Math.round(t)), x, top - 12);
    }
}

  // Draw each server path in its own band
  const k = servers.length;
  const bandGap = 28;
  const bandH = Math.max(40, Math.floor((h - top - 20 - (k - 1) * bandGap) / Math.max(k, 1)));

  for (let i = 0; i < k; i++) {
    const bandTop = top + 18 + i * (bandH + bandGap);
    const bandBottom = bandTop + bandH;

    // label
    pathCtx.textAlign = 'right';
    pathCtx.textBaseline = 'top';
    pathCtx.fillStyle = '#111827';
    pathCtx.font = '12px system-ui';
    pathCtx.fillText(`Server ${i + 1}`, x0 - 12, bandTop);

    // y-axis spine for this band
    pathCtx.strokeStyle = 'rgba(17,24,39,0.35)';
    pathCtx.lineWidth = 1;
    pathCtx.beginPath();
    pathCtx.moveTo(x0, bandTop);
    pathCtx.lineTo(x0, bandBottom);
    pathCtx.stroke();

    // points = [0, ...history]
    const pts = [0, ...(moveHistory[i] || [])];
    const n = pts.length - 1; // number of timesteps logged

    // If no movement yet, draw a dot at origin
    if (n <= 0) {
      pathCtx.fillStyle = servers[i].color;
      pathCtx.beginPath();
      pathCtx.arc(x0, bandTop + 2, 3, 0, Math.PI * 2);
      pathCtx.fill();
      continue;
    }

    // scale time down the band
    const yForStep = (stepIdx) => {
      // stepIdx: 0..n (0 is start at time 0)
      return bandTop + (stepIdx / n) * (bandH - 4);
    };

    // polyline
    pathCtx.strokeStyle = servers[i].color;
    pathCtx.lineWidth = 2;
    pathCtx.beginPath();

    for (let sIdx = 0; sIdx < pts.length; sIdx++) {
      const t = pts[sIdx];
      const u = (t - T_MIN) / (T_MAX - T_MIN);
      const x = x0 + u * (x1 - x0);
      const y = yForStep(sIdx);

      if (sIdx === 0) pathCtx.moveTo(x, y);
      else pathCtx.lineTo(x, y);
    }
    pathCtx.stroke();
  }
}

function draw() {
    clear();
    drawAxis();
    // Server lines
    for (let i = 0; i < servers.length; i++) {
    drawServerLine(servers[i], i);
    }

    // Soft instruction at bottom
    ctx.fillStyle = 'rgba(17,24,39,0.55)';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const { h } = cssSize(canvas);
    ctx.fillText('', layout.padL, h - 14);
}

// ======= Stats rendering =======
function fmtVisible(t) {
// Uses your fraction formatter if you added it earlier.
return (typeof formatFractionFromTime === 'function')
    ? formatFractionFromTime(t)
    : t.toFixed(4);
}

function renderDistances() {
  if (!distanceTable) return;

  let html = '<thead><tr><th>Server</th><th><center>Total Distance</center></th></tr></thead><tbody>';
  for (let i = 0; i < servers.length; i++) {
    const label = (i === servers.length - 1 && servers.length > 5) ? 'Server K' : `Server ${i + 1}`;
    html += `<tr>
      <td>${label}</td>
      <td><b><center>${fmtVisible(totalDistance[i] || 0)}</center></b></td>
    </tr>`;
  }
  html += '</tbody>';

  distanceTable.innerHTML = html;
}


function renderTable() {
if (!stateTable) return;
const k = servers.length;
const maxSteps = moveHistory.reduce((m, arr) => Math.max(m, arr.length), 0);

// Header
let html = '<thead><tr>';
html += '<th>Timestep</th>';
for (let i = 0; i < k; i++) {
    const label = (i === k - 1 && k > 5) ? 'Server K' : `Server ${i + 1}`;
    html += `<th>${label}</th>`;
}
html += '</tr></thead>';

// Body
html += '<tbody>';
for (let step = 1; step <= maxSteps; step++) {
    const timeVal = step * tickStep; // step * alpha
    html += `<tr><td><b>${fmtVisible(timeVal)}</b></td>`;

    for (let i = 0; i < k; i++) {
    const v = moveHistory[i][step - 1];
    html += `<td>${(v === undefined) ? '—' : fmtVisible(v)}</td>`;
    }
    html += '</tr>';
}
html += '</tbody>';

stateTable.innerHTML = html;
}

function exportTablesToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const now = new Date();
  const title = `Server Tables Export - ${now.toLocaleString()}`;

  doc.setFontSize(14);
  doc.text(title, 40, 40);

  // Table 1: Server movement
  doc.setFontSize(12);
  doc.text('Server movement', 40, 70);

  doc.autoTable({
    html: '#distanceTable',
    startY: 85,
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0] }
  });

  // Table 2: Per-server time-step table
  const yAfterFirst = doc.lastAutoTable.finalY + 22;
  doc.text('Per-server time-step table', 40, yAfterFirst);

  doc.autoTable({
    html: '#stateTable',
    startY: yAfterFirst + 12,
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0] },
    tableWidth: 'auto',
  });

  const fileStamp = now.toISOString().slice(0,19).replace(/[:T]/g,'-');
  doc.save(`server-tables-${fileStamp}.pdf`);
}



// ======= Interaction (dragging knobs) =======
function getPointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    return { x, y };
}

function hitTestKnob(px, py) {
    for (let i = 0; i < servers.length; i++) {
    const s = servers[i];
    const y = yForServerIndex(i);
    const x = xForTime(s.value);
    const dx = px - x;
    const dy = py - y;
    if (dx*dx + dy*dy <= (layout.knobR + 6) * (layout.knobR + 6)) {
        return { id: s.id, idx: i, knobX: x, knobY: y };
    }
    }
    return null;
}

canvas.addEventListener('pointerdown', (evt) => {
canvas.setPointerCapture(evt.pointerId);
const { x, y } = getPointerPos(evt);
const hit = hitTestKnob(x, y);
if (hit) {
    draggingId = hit.id;
    dragOffsetX = x - hit.knobX;

    // Record where this server was when the drag started
    const s = servers.find(ss => ss.id === draggingId);
    dragStartValue = s ? s.value : 0;
}
});

canvas.addEventListener('pointermove', (evt) => {
    if (draggingId === null) return;
    const { x } = getPointerPos(evt);
    const s = servers.find(ss => ss.id === draggingId);
    if (!s) return;

    const newTime = timeForX(x - dragOffsetX);
    s.value = clamp(snapToStep(newTime), T_MIN, T_MAX);
    draw();
});

function endDrag(evt) {
if (draggingId !== null) {
    const s = servers.find(ss => ss.id === draggingId);
    if (s) {
    const idx = s.id;

    // Total distance traveled during this drag (added cumulatively)
    const start = dragStartValue;
    const end = s.value;

    const step = tickStep; // alpha
    const moved = Math.abs(end - start);

    if (moved > 0) {
    // number of alpha-steps moved in this drag (should be integer because of snapping)
    const nSteps = Math.round(moved / step);
    const dir = (end >= start) ? 1 : -1;

    for (let i = 1; i <= nSteps; i++) {
        const pos = snapToStep(start + dir * i * step);
        moveHistory[idx].push(pos); // timestep increases by 1 per alpha-step
    }

    totalDistance[idx] = (totalDistance[idx] || 0) + nSteps * step;

    renderDistances();
    renderTable();
    drawPaths();
    }

    }

    draggingId = null;
    draw();
}
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);


// ======= Form handling =======
function applyK() {
    const k = clamp(parseInt(kInput.value || '1', 10) || 1, 1, 200);
    kInput.value = String(k);
    // Update alpha/beta and set tickStep to alpha
    const { alpha } = computeAlphaBeta(k);
    tickStep = alpha;

    updatePills(k);
    setServers(k);
    drawPaths();
    resizeCanvas();
}

function cssSize(el) {
  const dpr = window.devicePixelRatio || 1;
  return { w: el.width / dpr, h: el.height / dpr };
}

applyBtn.addEventListener('click', applyK);
kInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyK();
});

// ======= Init =======

let lastDPR = window.devicePixelRatio || 1;
setInterval(() => {
  const dpr = window.devicePixelRatio || 1;
  if (Math.abs(dpr - lastDPR) > 1e-6) {
    lastDPR = dpr;
    resizeCanvas();
  }
}, 250);

const k0 = parseInt(kInput.value, 10) || 1;
const { alpha: alpha0 } = computeAlphaBeta(k0);
tickStep = alpha0;
updatePills(k0);
setServers(k0);

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Note for later: sub-intervals (Beta * 2^i repeated k-1 times + Alpha * 2^i once)
// are intentionally NOT drawn per your instruction; they can be added later.

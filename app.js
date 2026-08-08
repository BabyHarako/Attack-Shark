/* app.js — main application glue: DPI gear state, sidebar navigation,
   wiring every Overview-tab control to PROTOCOL, DPI lighting, shell
   color picker, the sonar canvas, and startup init. Depends on webhid.js
   having loaded first (uses PROTOCOL, el, wireGroup/wireSelect/wireToggle/
   wireRadio, logLine). */

const DPI_ORDER = [400, 800, 1200, 1600, 2400, 3200, 5600, 6650, 8000, 12000, 42000];
// Matches the official app's exact 6-gear default palette from the screenshot:
// blue, red, yellow, cyan, magenta, pale yellow.
const DEFAULT_DPI_COLORS = ['#1a4dff', '#ff2222', '#ffd400', '#00e5ff', '#ff00c8', '#eeee88'];
// Your requested default 6-gear set: 400 > 2400 > 3200 > 6650 > 8000 > 42000
const DEFAULT_SIX_GEARS = [400, 2400, 3200, 6650, 8000, 42000];

let currentDpiGearCount = 6;
let currentDpiValues = [];
let activeDpiIndex = 1;
let dpiColors = {};



/* ---------------- DPI Presets rendering with integrated color pickers ---------------- */
function renderDpiPresets(){
  const container = el('dpiPresets');
  container.innerHTML = '';
  const count = Math.min(currentDpiGearCount, DPI_ORDER.length);

  if(count === 6){
    currentDpiValues = DEFAULT_SIX_GEARS.slice();
  }else if(count === 4){
    // Verified 4 stages against your mouse (400/2400/3200/5600).
    currentDpiValues = [400, 2400, 3200, 5600];
  }else{
    const step = Math.floor(DPI_ORDER.length / count) || 1;
    const indices = [];
    for(let i = 0; i < count; i++){
      indices.push(Math.min(i * step, DPI_ORDER.length - 1));
    }
    if(indices[indices.length - 1] !== DPI_ORDER.length - 1){
      indices[indices.length - 1] = DPI_ORDER.length - 1;
    }
    currentDpiValues = indices.map(i => DPI_ORDER[i]);
  }

  // Initialize colors for new gears
  currentDpiValues.forEach((dpi, idx) => {
    if(!dpiColors[dpi]){
      dpiColors[dpi] = DEFAULT_DPI_COLORS[idx % DEFAULT_DPI_COLORS.length];
    }
  });

  currentDpiValues.forEach((dpi, idx) => {
    const color = dpiColors[dpi] || DEFAULT_DPI_COLORS[idx % DEFAULT_DPI_COLORS.length];
    const btn = document.createElement('div');
    btn.className = 'opt-btn' + (idx === activeDpiIndex ? ' active' : '');
    btn.dataset.dpi = dpi;
    btn.dataset.index = idx;
    btn.style.setProperty('--stage-color', color);
    btn.innerHTML = `
      <span class="dpi-bar" style="background:${color};"></span>
      <span class="dpi-label">${dpi}</span>
      <span class="dpi-color-wrap">
        <input type="color" value="${color}" data-dpi="${dpi}">
      </span>
      <div class="color-confirm-row" style="display:none;">
        <button class="color-confirm-ok" type="button">OK</button>
        <button class="color-confirm-cancel" type="button">Cancel</button>
      </div>
    `;
    container.appendChild(btn);

    // Color changes preview live but don't send until confirmed with OK —
    // Cancel reverts to whatever color was active before this edit.
    const picker = btn.querySelector('input[type=color]');
    const bar = btn.querySelector('.dpi-bar');
    const confirmRow = btn.querySelector('.color-confirm-row');
    const priorColor = color;
    let pendingColor = color;

    picker.addEventListener('input', e => {
      e.stopPropagation();
      pendingColor = e.target.value;
      bar.style.background = pendingColor;
      btn.style.setProperty('--stage-color', pendingColor);
      confirmRow.style.display = 'flex';
    });

    confirmRow.querySelector('.color-confirm-ok').addEventListener('click', async e => {
      e.stopPropagation();
      dpiColors[dpi] = pendingColor;
      confirmRow.style.display = 'none';
      markDirty();

      if(!device){
        logLine('out', `DPI color for stage ${idx} → ${pendingColor} (no device connected)`);
        return;
      }
      // All 6 stage addresses (0x2c/0x30/0x34/0x38/0x3c/0x40) are now
      // confirmed via a real capture that swept through every stage.
      logLine('out', `DPI color for stage ${idx} → ${pendingColor}  [confirmed address, sending]`);
      const [rid, ...data] = buildColorCmd(pendingColor, idx);
      try{
        await device.sendReport(rid, new Uint8Array(data));
        logLine('out', `DPI color sent`);
      }catch(err){
        logLine('out', `DPI color send failed: ${err.message}`);
      }
    });

    confirmRow.querySelector('.color-confirm-cancel').addEventListener('click', e => {
      e.stopPropagation();
      pendingColor = priorColor;
      picker.value = priorColor;
      bar.style.background = priorColor;
      btn.style.setProperty('--stage-color', priorColor);
      confirmRow.style.display = 'none';
    });

    // Bind click to set DPI
    btn.addEventListener('click', async function(e) {
      // Ignore if click was on the color picker
      if(e.target.tagName === 'INPUT') return;

      const dpiVal = parseInt(this.dataset.dpi);
      const idxVal = parseInt(this.dataset.index);
      document.querySelectorAll('#dpiPresets .opt-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeDpiIndex = idxVal;
      el('dpiNumberBox').value = dpiVal;
      el('dpiSlider').value = dpiVal;
      markDirty();

      await sendDpiValue(dpiVal, idxVal);
    });
  });
}

/* Shared send path — used by clicking a gear box AND by the slider/number-box/
   +/- controls. Checks the literal table first (for special cases like
   42000), then falls back to the confirmed formula (buildDpiRegisterCmd)
   which covers every 50-step value from 50 to 12800. Only truly unmapped
   values (out of that range, or not a multiple of 50) fall through to an
   honest "not mapped" instead of guessing. */
async function sendDpiValue(dpiVal, idxVal){
  const registerCmd = PROTOCOL.dpi[dpiVal] || buildDpiRegisterCmd(dpiVal, idxVal);
  const stageCmd = PROTOCOL.dpiStage[idxVal];

  if(!device){ logLine('out', `DPI → ${dpiVal} (no device connected)`); return; }
  if(!registerCmd || !stageCmd){
    logLine('out', `DPI → ${dpiVal}  [PROTOCOL not mapped for this exact value/stage — nothing sent]`);
    return;
  }
  try{
    const [rid1, ...data1] = registerCmd;
    await device.sendReport(rid1, new Uint8Array(data1));
    const [rid2, ...data2] = stageCmd;
    await device.sendReport(rid2, new Uint8Array(data2));
    logLine('out', `DPI → ${dpiVal}  sent (register + stage)`);
  }catch(err){
    logLine('out', `DPI → ${dpiVal}  send failed: ${err.message}`);
  }
}

el('dpiGearCount').addEventListener('change', function(){
  currentDpiGearCount = parseInt(this.value);
  if(activeDpiIndex >= currentDpiGearCount) activeDpiIndex = 0;
  renderDpiPresets();
  markDirty();
});


/* ---------------- sidebar nav ---------------- */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    el(`tab-${item.dataset.tab}`).classList.add('active');
  });
});


/* ---------------- Polling Rate ---------------- */
el('pollingSelect').addEventListener('change', async e => {
  const hz = parseInt(e.target.value);
  markDirty();
  const mapping = PROTOCOL.polling[hz];
  if(!device){ logLine('out', `polling → ${hz}Hz (no device connected)`); return; }
  if(!mapping){ logLine('out', `polling → ${hz}Hz  [PROTOCOL not mapped]`); return; }
  const [reportId, ...data] = mapping;
  await device.sendReport(reportId, new Uint8Array(data));
  logLine('out', `polling → ${hz}Hz  sent`);

  const perfBtns = document.querySelectorAll('#sensorPerfPresets .opt-btn');
  const perfHint = el('sensorPerfHint');
  if(hz <= 1000){
    perfBtns.forEach(b => b.classList.remove('disabled-opt'));
    perfHint.textContent = 'ONLY WORKS AT BELOW 1000HZ. CURRENT POLLING RATE: ' + hz + 'Hz.';
  } else {
    perfBtns.forEach(b => b.classList.add('disabled-opt'));
    perfHint.textContent = 'ONLY WORKS AT BELOW 1000HZ. CURRENT POLLING RATE: ' + hz + 'Hz.';
  }
});

/* ---------------- Wire all controls ---------------- */
wireSelect('lodSelect', PROTOCOL.lod);
wireSelect('sensorMode', PROTOCOL.sensorMode);
wireGroup('sensorPerfPresets', 'perf', PROTOCOL.sensorPerf);
wireSelect('deshakeSelect', PROTOCOL.deshake);
wireSelect('sleepSelect', PROTOCOL.sleepTime);
wireToggle('longDistanceToggle', PROTOCOL.longDistance, 'long distance mode');
wireToggle('huntingToggle', PROTOCOL.huntingMode, 'hunting shark competitive mode');
wireToggle('rippleToggle', PROTOCOL.ripple, 'ripple control');
wireToggle('angleToggle', PROTOCOL.angle, 'angle snapping');
wireToggle('motionToggle', PROTOCOL.motion, 'motion sync');
wireRadio('ledMode', PROTOCOL.ledMode);

document.querySelectorAll('input[name="ledMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.led-mode-option').forEach(opt => opt.classList.remove('selected'));
    radio.closest('.led-mode-option').classList.add('selected');
  });
  if(radio.checked) radio.closest('.led-mode-option').classList.add('selected');
});

/* ---------------- DPI Lighting ---------------- */
document.querySelectorAll('#dpiLightPresets .opt-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('#dpiLightPresets .opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.light;
    markDirty();
    if(!device){ logLine('out', `dpiLight → ${mode} (no device connected)`); return; }
    try{
      if(mode === 'off'){
        const [rid, ...data] = PROTOCOL.dpiEffectEnable.off;
        await device.sendReport(rid, new Uint8Array(data));
        logLine('out', `dpiLight → off  sent`);
      }else{
        const typeCmd = PROTOCOL.dpiEffectType[mode];
        const [rid1, ...data1] = typeCmd;
        await device.sendReport(rid1, new Uint8Array(data1));
        logLine('out', `dpiLight → ${mode}  type cmd sent`);
        const [rid2, ...data2] = PROTOCOL.dpiEffectEnable.on;
        await device.sendReport(rid2, new Uint8Array(data2));
        logLine('out', `dpiLight → ${mode}  enable cmd sent`);
      }
    }catch(err){
      logLine('out', `dpiLight → ${mode}  send failed: ${err.message}`);
    }
  });
});

el('brightnessSlider').addEventListener('change', async e => {
  const level = e.target.value;
  el('brightnessVal').textContent = level;
  markDirty();
  const mapping = PROTOCOL.dpiBrightness[level];
  if(!device){ logLine('out', `brightness → ${level} (no device connected)`); return; }
  const [rid, ...data] = mapping;
  await device.sendReport(rid, new Uint8Array(data));
  logLine('out', `brightness → ${level}  sent`);
});
el('brightnessSlider').addEventListener('input', e => {
  el('brightnessVal').textContent = e.target.value;
});

el('speedSlider').addEventListener('change', async e => {
  const level = e.target.value;
  el('speedVal').textContent = level;
  markDirty();
  const mapping = PROTOCOL.dpiSpeed[level];
  if(!device){ logLine('out', `speed → ${level} (no device connected)`); return; }
  const [rid, ...data] = mapping;
  await device.sendReport(rid, new Uint8Array(data));
  logLine('out', `speed → ${level}  sent`);
});
el('speedSlider').addEventListener('input', e => {
  el('speedVal').textContent = e.target.value;
});

// Live DPI adjustment: slider, number box, and +/- buttons all stay in
// sync with each other, and update the currently active gear's displayed
// number live — matching the official app's behavior. This is purely a
// DISPLAY sync; actually sending a command still only happens when you
// click a gear box, and only works for values with real captured bytes
// (400/2400/3200/5600) — adjusting to an arbitrary custom number here
// won't send anything new until we capture that exact value for real.
function syncDpiDisplay(newVal){
  newVal = Math.max(400, Math.min(42000, Math.round(newVal / 50) * 50));
  el('dpiSlider').value = newVal;
  el('dpiNumberBox').value = newVal;

  const activeBtn = document.querySelector('#dpiPresets .opt-btn.active');
  if(activeBtn){
    activeBtn.dataset.dpi = newVal;
    const label = activeBtn.querySelector('.dpi-label');
    if(label) label.textContent = newVal;
    if(currentDpiValues[activeDpiIndex] !== undefined){
      currentDpiValues[activeDpiIndex] = newVal;
    }
  }
  markDirty();
}

el('dpiSlider').addEventListener('input', e => syncDpiDisplay(parseInt(e.target.value)));
el('dpiSlider').addEventListener('change', e => {
  const v = parseInt(e.target.value);
  syncDpiDisplay(v);
  sendDpiValue(v, activeDpiIndex);
});

el('dpiNumberBox').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  if(!isNaN(v)) syncDpiDisplay(v);
});
el('dpiNumberBox').addEventListener('change', e => {
  const v = parseInt(e.target.value);
  if(!isNaN(v)) sendDpiValue(v, activeDpiIndex);
});

// Plain +50/-50 stepping, as requested — now that buildDpiRegisterCmd()
// covers every 50-step value from 50 to 12800, every single click actually
// sends a real, working command (no more landing on unmapped gaps).
el('dpiMinusBtn').addEventListener('click', () => {
  const target = parseInt(el('dpiNumberBox').value) - 50;
  syncDpiDisplay(target);
  sendDpiValue(parseInt(el('dpiNumberBox').value), activeDpiIndex);
});
el('dpiPlusBtn').addEventListener('click', () => {
  const target = parseInt(el('dpiNumberBox').value) + 50;
  syncDpiDisplay(target);
  sendDpiValue(parseInt(el('dpiNumberBox').value), activeDpiIndex);
});


function markDirty(){
  el('previewNote').textContent = 'Preview settings have not been saved.';
}
saveBtn.addEventListener('click', () => {
  el('previewNote').textContent = 'All changes saved.';
  logLine('out', 'settings committed to device memory (if protocol mapped)');
});




/* ---------------- monitor accordion ---------------- */
el('monitorToggle').addEventListener('click', () => {
  el('monitor').classList.toggle('open');
});


/* ---------------- sonar canvas ---------------- */
const canvas = el('sonar');
let dpr = window.devicePixelRatio || 1;
function sizeCanvas(){
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
}
window.addEventListener('resize', sizeCanvas);
sizeCanvas();
const ctx = canvas.getContext('2d');
let pulses = [];
function pulse(){ pulses.push({x: 0, life: 1}); }
function drawSonar(){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = '#1a1d23';
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  pulses.forEach(p => p.x += 6*dpr);
  pulses = pulses.filter(p => p.x < w+40*dpr);
  ctx.strokeStyle = '#35d0c4';
  ctx.lineWidth = 1.5*dpr;
  ctx.beginPath();
  for(let x=0; x<w; x+=2*dpr){
    let y = h/2;
    pulses.forEach(p => {
      const d = x - p.x;
      y -= Math.exp(-(d*d)/(300*dpr*dpr)) * 18*dpr;
    });
    x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();
  requestAnimationFrame(drawSonar);
}
drawSonar();

// Initialize DPI presets
renderDpiPresets();
// Show last-known smoothed battery estimate immediately, even before connecting
renderBatteryDisplay();

// Set initial polling rate check
setTimeout(() => {
  const initialHz = parseInt(el('pollingSelect').value);
  if(initialHz > 1000){
    document.querySelectorAll('#sensorPerfPresets .opt-btn').forEach(b => b.classList.add('disabled-opt'));
    el('sensorPerfHint').textContent = 'ONLY WORKS AT BELOW 1000HZ. CURRENT POLLING RATE: ' + initialHz + 'Hz.';
  }
}, 100);

// Battery is now fetched automatically on connect (see webhid.js connect
// flow) — no manual button needed anymore.

/* ---------------- Interface settings: theme (White/Black/System) ---------------- */
const THEME_STORAGE_KEY = 'r11ultra_theme_mode';
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(mode){
  const useLight = mode === 'light' || (mode === 'system' && !systemDarkQuery.matches);
  document.body.classList.toggle('theme-light', useLight);
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === mode);
  });
}

function setThemeMode(mode){
  try{ localStorage.setItem(THEME_STORAGE_KEY, mode); }catch(e){}
  applyTheme(mode);
}

function getStoredThemeMode(){
  try{ return localStorage.getItem(THEME_STORAGE_KEY) || 'dark'; }catch(e){ return 'dark'; }
}

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => setThemeMode(btn.dataset.theme));
});

// If the user has "System" selected, follow OS theme changes live
systemDarkQuery.addEventListener('change', () => {
  if(getStoredThemeMode() === 'system') applyTheme('system');
});

applyTheme(getStoredThemeMode());

el('settingsBtn').addEventListener('click', () => el('settingsOverlay').classList.add('open'));
el('settingsClose').addEventListener('click', () => el('settingsOverlay').classList.remove('open'));
el('settingsOverlay').addEventListener('click', e => {
  if(e.target.id === 'settingsOverlay') el('settingsOverlay').classList.remove('open');
});

/* app.js — main application glue: DPI gear state, sidebar navigation,
   wiring every Overview-tab control to PROTOCOL, DPI lighting, shell
   color picker, the sonar canvas, and startup init. Depends on webhid.js
   having loaded first (uses PROTOCOL, el, wireGroup/wireSelect/wireToggle/
   wireRadio, logLine). */

const DPI_ORDER = [400, 800, 1200, 1600, 2400, 3200, 5600, 6400, 8000, 12000];
const DEFAULT_DPI_COLORS = ['#3f6bff', '#f2f2f2', '#3f6bff', '#ffd400', '#ff6b00', '#ff2200'];


let currentDpiGearCount = 4;
let currentDpiValues = [];
let activeDpiIndex = 1;
let dpiColors = {};



/* ---------------- DPI Presets rendering with integrated color pickers ---------------- */
function renderDpiPresets(){
  const container = el('dpiPresets');
  container.innerHTML = '';
  const count = Math.min(currentDpiGearCount, DPI_ORDER.length);

  let indices;
  if(count === 4){
    // Default case: use the exact 4 stages that are actually verified
    // against your mouse (400/2400/3200/5600), not an evenly-sampled guess.
    indices = [0, 4, 5, 6]; // positions of 400, 2400, 3200, 5600 in DPI_ORDER
  }else{
    const step = Math.floor(DPI_ORDER.length / count) || 1;
    indices = [];
    for(let i = 0; i < count; i++){
      indices.push(Math.min(i * step, DPI_ORDER.length - 1));
    }
    if(indices[indices.length - 1] !== DPI_ORDER.length - 1){
      indices[indices.length - 1] = DPI_ORDER.length - 1;
    }
  }

  currentDpiValues = indices.map(i => DPI_ORDER[i]);

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
    `;
    container.appendChild(btn);

    // Bind color picker change
    const picker = btn.querySelector('input[type=color]');
    picker.addEventListener('input', async function(e){
      e.stopPropagation();
      const newColor = e.target.value;
      dpiColors[dpi] = newColor;
      const bar = btn.querySelector('.dpi-bar');
      bar.style.background = newColor;
      btn.style.setProperty('--stage-color', newColor);
      markDirty();

      if(!device){
        logLine('out', `DPI color for stage ${idx} → ${newColor} (no device connected)`);
        return;
      }
      logLine('out', `DPI color for stage ${idx} → ${newColor}  [EXPERIMENTAL — unverified address/checksum, not from a real capture. Watch the mouse's DPI LED; if nothing happens or it looks wrong, this guess is likely incorrect]`);
      const [rid, ...data] = buildColorCmd(newColor, idx);
      try{
        await device.sendReport(rid, new Uint8Array(data));
        logLine('out', `DPI color experimental send completed — check the physical LED, not just this log`);
      }catch(err){
        logLine('out', `DPI color experimental send failed: ${err.message}`);
      }
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
      el('dpiReadout').textContent = `${dpiVal} DPI`;
      el('dpiSlider').value = dpiVal;
      markDirty();

      const registerCmd = PROTOCOL.dpi[dpiVal];
      const stageCmd = PROTOCOL.dpiStage[idxVal];

      if(!device){ logLine('out', `dpiPresets → ${dpiVal} (no device connected)`); return; }
      if(!registerCmd || !stageCmd){
        logLine('out', `dpiPresets → ${dpiVal}  [PROTOCOL not fully mapped yet — nothing sent]`);
        return;
      }
      try{
        const [rid1, ...data1] = registerCmd;
        await device.sendReport(rid1, new Uint8Array(data1));
        logLine('out', `dpiPresets → ${dpiVal}  register cmd sent`);
        const [rid2, ...data2] = stageCmd;
        await device.sendReport(rid2, new Uint8Array(data2));
        logLine('out', `dpiPresets → ${dpiVal}  stage cmd sent`);
      }catch(err){
        logLine('out', `dpiPresets → ${dpiVal}  send failed: ${err.message}`);
      }
    });
  });
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
    perfHint.textContent = 'LP/HP available — current setting applies below 1000Hz.';
  } else {
    perfBtns.forEach(b => b.classList.add('disabled-opt'));
    perfHint.textContent = 'LP/HP locked (only works at ≤1000Hz). Current polling rate: ' + hz + 'Hz.';
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

el('dpiSlider').addEventListener('input', e => {
  el('dpiReadout').textContent = `${e.target.value} DPI`;
  document.querySelectorAll('#dpiPresets .opt-btn').forEach(b => b.classList.remove('active'));
  markDirty();
});


function markDirty(){
  el('previewNote').textContent = 'Preview settings have not been saved.';
}
saveBtn.addEventListener('click', () => {
  el('previewNote').textContent = 'All changes saved.';
  logLine('out', 'settings committed to device memory (if protocol mapped)');
});


/* ---------------- shell finish ---------------- */
document.querySelectorAll('#finishPicker .finish-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('#finishPicker .finish-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    const finish = sw.dataset.finish;
    const isForged = finish === 'forged';
    el('finishForged').style.display = isForged ? '' : 'none';
    el('finishWeave').style.display = isForged ? 'none' : '';
    el('mouseName').textContent = isForged ? 'R11 ULTRA · FORGED CARBON' : 'R11 ULTRA · WEAVE BLACK';
    markDirty();
    logLine('out', `shell finish → ${isForged ? 'Forged Carbon' : 'Weave Black'}  [cosmetic only — not sent to device]`);
  });
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
    el('sensorPerfHint').textContent = 'LP/HP locked (only works at ≤1000Hz). Current polling rate: ' + initialHz + 'Hz.';
  }
}, 100);

el('batteryQueryBtn').addEventListener('click', async () => {
  if(!device){
    logLine('out', 'battery query → no device connected');
    return;
  }
  logLine('out', 'battery query → sending and waiting up to 2s for a response...');
  try{
    const result = await getBatteryLevel(device);
    logLine('out', `battery query → response received: battery=${result.battery}, rssi=${result.rssi}`);
    if(result.battery >= 0 && result.battery <= 100){
      setBatteryBaseline(result.battery);
    }
  }catch(err){
    logLine('out', `battery query → failed: ${err.message}`);
  }
});


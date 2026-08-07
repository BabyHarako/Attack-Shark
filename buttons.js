/* buttons.js — Buttons tab: mouse-diagram hotspots, remap-panel open/close,
   shared state (buttonAssignments, currentRemapButton) used by popup.js and
   macro.js, plus config export/import/restore. Load after webhid.js + app.js,
   before popup.js and macro.js. */

let currentRemapButton = null;
const buttonAssignments = {}; // btnKey -> { type: 'system'|'special'|'macro', value: ... }


function openRemapPanel(btnKey){
  currentRemapButton = btnKey;
  el('remapOverlay').classList.add('open');
  document.querySelectorAll('.remap-list-item').forEach(item => {
    item.classList.toggle('selected', buttonAssignments[btnKey]?.value === item.dataset.fn);
  });
}
function closeRemapPanel(){
  el('remapOverlay').classList.remove('open');
  currentRemapButton = null;
}


document.querySelectorAll('.btn-hotspot').forEach(spot => {
  spot.addEventListener('click', () => openRemapPanel(spot.dataset.btn));
});
el('remapClose').addEventListener('click', closeRemapPanel);
el('remapOverlay').addEventListener('click', e => {
  if(e.target.id === 'remapOverlay') closeRemapPanel();
});


/* ---- Config export/import: saves this tool's own UI state, not the
   mouse's onboard EEPROM (button remap storage format is unknown). ---- */
function collectCurrentSettings(){
  return {
    dpi: currentDpiValues,
    activeDpiIndex,
    dpiColors,
    polling: el('pollingSelect') ? el('pollingSelect').value : null,
    lod: el('lodSelect') ? el('lodSelect').value : null,
    sensorMode: el('sensorMode') ? el('sensorMode').value : null,
    deshake: el('deshakeSelect') ? el('deshakeSelect').value : null,
    sleepTime: el('sleepSelect') ? el('sleepSelect').value : null,
    ledMode: document.querySelector('input[name=ledMode]:checked')?.value,
    buttonAssignments
  };
}

el('exportCfgBtn').addEventListener('click', () => {
  const data = JSON.stringify(collectCurrentSettings(), null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'r11-ultra-config.json';
  a.click();
  URL.revokeObjectURL(url);
  logLine('out', 'exported current tool settings to r11-ultra-config.json');
});

el('importCfgBtn').addEventListener('click', () => el('importCfgFile').click());
el('importCfgFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    Object.assign(buttonAssignments, data.buttonAssignments || {});
    if(data.dpiColors) Object.assign(dpiColors, data.dpiColors);
    logLine('out', `imported settings from ${file.name}`);
    markDirty();
  }catch(err){
    logLine('out', `import failed: ${err.message}`);
  }
});

el('restoreCfgBtn').addEventListener('click', () => {
  for(const k in buttonAssignments) delete buttonAssignments[k];
  logLine('out', 'restore factory settings → [PROTOCOL not mapped, cannot write to device — cleared local button assignments only]');
});

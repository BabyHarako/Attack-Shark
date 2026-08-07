/* macro.js — macro recorder. Fully functional client-side (captures real
   keyboard events with real timing) independent of device protocol.
   Depends on buttons.js (buttonAssignments, currentRemapButton). */

/* ---- Macro recorder: this part IS fully functional client-side, since
   it only captures your own keyboard events in the browser — no device
   protocol needed to record a macro, only to eventually send it. ---- */
let macroRecording = false;
let macroEvents = [];
let macroLastTime = 0;

function macroKeyHandler(e){
  if(!macroRecording) return;
  e.preventDefault();
  const now = performance.now();
  const delay = macroLastTime ? Math.round(now - macroLastTime) : 0;
  macroLastTime = now;
  macroEvents.push({ type: e.type === 'keydown' ? 'P' : 'R', key: e.key, delay });
  renderMacroTable();
}
document.addEventListener('keydown', macroKeyHandler);
document.addEventListener('keyup', macroKeyHandler);

function renderMacroTable(){
  const body = el('macroTableBody');
  body.innerHTML = macroEvents.map(ev =>
    `<tr><td class="${ev.type === 'P' ? 'press' : 'release'}">${ev.type}</td><td>${ev.key}</td><td>${ev.delay}</td></tr>`
  ).join('');
}

el('macroStartBtn').addEventListener('click', () => {
  macroRecording = !macroRecording;
  const btn = el('macroStartBtn');
  if(macroRecording){
    macroEvents = [];
    macroLastTime = 0;
    btn.textContent = '■ Stop Recording';
    btn.style.background = 'var(--accent)';
    logLine('out', 'macro recording started — keystrokes are captured in-browser only');
  }else{
    btn.textContent = '▶ Start Recording';
    btn.style.background = '';
    logLine('out', `macro recording stopped — ${macroEvents.length} event(s) captured`);
  }
});

el('macroSaveBtn').addEventListener('click', () => {
  if(!currentRemapButton) return;
  const name = el('macroName').value || 'Unnamed macro';
  buttonAssignments[currentRemapButton] = { type: 'macro', name, events: macroEvents };
  markDirty();
  logLine('out', `button[${currentRemapButton}] → Macro "${name}" (${macroEvents.length} events)  [saved locally — PROTOCOL not mapped, so it cannot be sent to the mouse yet]`);
});


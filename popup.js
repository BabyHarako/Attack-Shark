/* popup.js — remap popup behavior: tab switching (System/Special/Macro),
   System function list selection, Firepower Key and Combination Key save
   handlers. Depends on buttons.js (buttonAssignments, currentRemapButton). */

document.querySelectorAll('.remap-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.remap-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.remap-body').forEach(b => b.classList.remove('active'));
    tab.classList.add('active');
    el(`remap-${tab.dataset.remaptab}`).classList.add('active');
  });
});


document.querySelectorAll('.remap-list-item').forEach(item => {
  item.addEventListener('click', async () => {
    if(!currentRemapButton) return;
    document.querySelectorAll('.remap-list-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    const fn = item.dataset.fn;
    buttonAssignments[currentRemapButton] = { type: 'system', value: fn };
    markDirty();

    const sequence = PROTOCOL.buttonRemap?.[currentRemapButton]?.[fn];
    if(!device){
      logLine('out', `button[${currentRemapButton}] → ${fn}  (no device connected)`);
      return;
    }
    if(!sequence){
      logLine('out', `button[${currentRemapButton}] → ${fn}  [PROTOCOL not mapped — this button/function combo hasn't been captured yet]`);
      return;
    }
    try{
      for(const packet of sequence){
        const [reportId, ...data] = packet;
        await device.sendReport(reportId, new Uint8Array(data));
      }
      logLine('out', `button[${currentRemapButton}] → ${fn}  sent (${sequence.length} packet${sequence.length > 1 ? 's' : ''})`);
    }catch(err){
      logLine('out', `button[${currentRemapButton}] → ${fn}  send failed: ${err.message}`);
    }
  });
});


el('firepowerSave').addEventListener('click', () => {
  if(!currentRemapButton) return;
  const freq = el('firepowerFreq').value, interval = el('firepowerInterval').value;
  buttonAssignments[currentRemapButton] = { type: 'firepower', freq, interval };
  markDirty();
  logLine('out', `button[${currentRemapButton}] → Firepower (freq=${freq}, interval=${interval})  [PROTOCOL not mapped]`);
});


document.querySelectorAll('.combo-mod').forEach(mod => {
  mod.addEventListener('click', () => mod.classList.toggle('active'));
});
el('comboSave').addEventListener('click', () => {
  if(!currentRemapButton) return;
  const mods = Array.from(document.querySelectorAll('.combo-mod.active')).map(m => m.dataset.mod);
  const key = el('comboKey').value;
  buttonAssignments[currentRemapButton] = { type: 'combo', mods, key };
  markDirty();
  logLine('out', `button[${currentRemapButton}] → Combo ${mods.join('+')}+${key}  [PROTOCOL not mapped]`);
});


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
  item.addEventListener('click', () => {
    if(!currentRemapButton) return;
    document.querySelectorAll('.remap-list-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    buttonAssignments[currentRemapButton] = { type: 'system', value: item.dataset.fn };
    markDirty();
    if(!device){
      logLine('out', `button[${currentRemapButton}] → ${item.dataset.fn}  (no device connected)`);
    }else{
      logLine('out', `button[${currentRemapButton}] → ${item.dataset.fn}  [PROTOCOL not mapped — button remap bytes not yet captured]`);
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


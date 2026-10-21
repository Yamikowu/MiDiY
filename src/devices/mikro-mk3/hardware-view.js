import { getControl } from './controls.js';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One physical layout, independently mounted in Testing and Mapping.
function controlButton(id, extra = '', displayLabel = '') {
  const control = getControl(id) ?? { label: 'Encoder 觸碰' };
  return `<button type="button" class="hw-button ${extra}" data-control="${id}" aria-label="選取 ${escapeHtml(control.label)}" title="${escapeHtml(control.label)}">${extra === 'pad' ? `<span class="pad-label">${id.slice(4)}</span><span class="pad-assignment"></span>` : extra === 'touch' ? '' : escapeHtml(displayLabel || control.label)}</button>`;
}

export function renderHardware(target, onSelect, { includeEncoderTouch = false } = {}) {
  target.innerHTML = `
    <div class="device-face">
      <div class="device-left">
        <div class="device-upper">
          <div class="browser-zone">${controlButton('PROJECT', 'icon-key', '⦿')}${controlButton('FAVORITES', 'icon-key', '★')}${controlButton('BROWSER', 'icon-key', '☰')}</div>
          <div class="edit-zone">
            <div class="display-encoder"><div class="screen" aria-label="螢幕示意"></div><div class="encoder-cluster">${controlButton('ENCODER_ROTATE', 'encoder', '↻')}${includeEncoderTouch ? controlButton('ENCODER_TOUCH', 'touch') : ''}${controlButton('ENCODER_PUSH', 'push', '●')}</div></div>
            <div class="quick-edit">${['VOLUME','SWING','TEMPO'].map(id => controlButton(id)).join('')}</div>
            <div class="edit-tools">${controlButton('PLUG_IN')}${controlButton('SAMPLING')}<div class="arrows">${controlButton('ARROW_LEFT', '', '◀')}${controlButton('ARROW_RIGHT', '', '▶')}</div></div>
          </div>
        </div>
        <div class="device-logo">◉ MASCHINE <span>MIKRO MK3</span></div>
        <div class="performance-zone"><div class="strip-modes">${['PITCH','MOD','PERFORM','NOTES'].map(id => controlButton(id)).join('')}</div><div class="strip-lights" aria-hidden="true">${Array.from({ length: 25 }, () => '<span class="strip-light"></span>').join('')}</div>${controlButton('SMART_STRIP', 'strip', '')}<div class="performance-actions">${['GROUP','AUTO','LOCK','NOTE_REPEAT'].map(id => controlButton(id)).join('')}</div></div>
        <div class="transport-zone"><div class="transport-grid">${['RESTART','ERASE','TAP','FOLLOW','PLAY','REC','STOP','SHIFT'].map(id => controlButton(id)).join('')}</div></div>
      </div>
      <div class="device-right"><div class="padmode-grid">${['FIXED_VEL','PAD_MODE','KEYBOARD','CHORDS','STEP'].map(id => controlButton(id)).join('')}</div><div class="pad-area"><div class="mode-grid">${['SCENE','PATTERN','EVENTS','VARIATION','DUPLICATE','SELECT','SOLO','MUTE'].map(id => controlButton(id)).join('')}</div><div class="pads">${[13,14,15,16,9,10,11,12,5,6,7,8,1,2,3,4].map(n => controlButton(`PAD_${n}`, 'pad')).join('')}</div></div></div>
    </div>`;
  target.addEventListener('click', event => {
    const button = event.target.closest('[data-control]');
    if (button && target.contains(button)) onSelect(button.dataset.control);
  });
}

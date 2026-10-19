export const groups = [
  { id: 'browser', label: '瀏覽', controls: ['PROJECT', 'FAVORITES', 'BROWSER'] },
  { id: 'edit', label: '編輯', controls: ['ENCODER_PUSH', 'ENCODER_ROTATE', 'VOLUME', 'SWING', 'TEMPO', 'PLUG_IN', 'SAMPLING', 'ARROW_LEFT', 'ARROW_RIGHT'] },
  { id: 'performance', label: '演奏', controls: ['PITCH', 'MOD', 'PERFORM', 'NOTES', 'SMART_STRIP', 'GROUP', 'AUTO', 'LOCK', 'NOTE_REPEAT'] },
  { id: 'transport', label: '走帶', controls: ['PLAY', 'REC', 'STOP', 'RESTART', 'ERASE', 'TAP', 'FOLLOW', 'SHIFT'] },
  { id: 'mode', label: '模式', controls: ['MUTE', 'SOLO', 'SELECT', 'DUPLICATE', 'VARIATION', 'EVENTS', 'PATTERN', 'SCENE'] },
  { id: 'padmode', label: 'Pad 模式', controls: ['PAD_MODE', 'KEYBOARD', 'CHORDS', 'STEP', 'FIXED_VEL'] },
  { id: 'pads', label: '16 Pads', controls: Array.from({ length: 16 }, (_, i) => `PAD_${i + 1}`) }
];

export const controls = groups.flatMap(group => group.controls.map(id => ({
  id,
  group: group.id,
  label: id === 'ENCODER_PUSH' ? 'Encoder 按下' : id === 'ENCODER_ROTATE' ? 'Encoder 旋轉' : id === 'SMART_STRIP' ? 'Smart Strip' : /^PAD_\d+$/.test(id) ? `Pad ${id.slice(4)}` : id.replaceAll('_', ' '),
  instruction: id === 'ENCODER_ROTATE' ? '順時針轉動 3 格、逆時針轉動 3 格。' : id === 'SMART_STRIP' ? '觸碰、滑動，再離開 Smart Strip。' : /^PAD_\d+$/.test(id) ? '輕按一次、重按一次，每次都放開。' : '按下並放開 2 次。'
})));

export const getControl = id => controls.find(control => control.id === id);

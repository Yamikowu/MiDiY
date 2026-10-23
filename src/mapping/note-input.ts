import { l, t, labelMarkup, translateLabel } from '../i18n/index';
import { isMidiNote, midiNote, noteName, noteParts, octavesForPitch, PITCH_NAMES,
  type NotePreferencesValue, type NotePreferences } from './note-format';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** The numeric input is canonical, retaining its ID/dataset, value, validity and event path. */
export function noteFieldMarkup(id: string, label: string, value: number | '', prefs: NotePreferencesValue, batchKey?: string): string {
  return `<div class="note-input" data-note-input role="group" aria-label="${escape(label)}" data-note-label="${escape(label)}" data-note-middle="${prefs.middleC}">
    <label data-note-number-label>${labelMarkup(label)}<input data-note-number id="${id}" type="number" min="0" max="127" step="1" value="${value}" ${batchKey ? `data-batch-key="${batchKey}" placeholder="${escape(t('multiple_values'))}"` : 'required'}></label>
    <div data-note-names hidden><div class="note-name-row">
      <label><span class="note-name-label">MIDI Note/${l('note_pitch')}</span><select data-note-pitch></select></label>
      <label>${l('note_octave')}<select data-note-octave></select></label>
    </div></div>
    <small class="note-hint" data-note-hint aria-live="polite"></small>
  </div>`;
}
/** Only web controls depend on the DOM; preferences/conversions have no runtime dependency. */
export class NoteInputs {
  constructor(private readonly root: HTMLElement, private readonly preferences: NotePreferences,
    private readonly incompleteChanged: () => void) {
    root.addEventListener('input', event => this.handle(event), true);
    root.addEventListener('change', event => this.handle(event), true);
  }
  private handle(event: Event) {
    const target = event.target as HTMLElement;
    const field = target.closest<HTMLElement>('[data-note-input]');
    if (!field || !this.root.contains(field)) return;
    if (target.matches('[data-note-pitch],[data-note-octave]')) {
      // Auxiliary controls never enter the existing batch/dirty handlers themselves.
      event.stopImmediatePropagation();
      if (event.type !== 'change') return;
      const input = field.querySelector<HTMLInputElement>('[data-note-number]')!;
      const pitch = field.querySelector<HTMLSelectElement>('[data-note-pitch]')!.value;
      const octave = field.querySelector<HTMLSelectElement>('[data-note-octave]')!.value;
      const next = pitch === '' || octave === '' ? null : midiNote(Number(pitch), Number(octave), this.preferences.current.middleC);
      if (next !== null && input.value !== String(next)) {
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        this.sync(field);
        if (next === null) this.incompleteChanged();
      }
    } else if (target.matches('[data-note-number]')) this.sync(field, true);
  }
  refresh() { this.root.querySelectorAll<HTMLElement>('[data-note-input]').forEach(field => this.sync(field)); }
  private sync(field: HTMLElement, clearPartial = false) {
    const prefs = this.preferences.current;
    const input = field.querySelector<HTMLInputElement>('[data-note-number]')!;
    const pitchSelect = field.querySelector<HTMLSelectElement>('[data-note-pitch]')!;
    const octaveSelect = field.querySelector<HTMLSelectElement>('[data-note-octave]')!;
    const valid = input.value !== '' && isMidiNote(Number(input.value));
    let pitch = clearPartial ? '' : pitchSelect.value;
    let octave = clearPartial ? '' : octaveSelect.value;
    if (valid) {
      const parts = noteParts(Number(input.value), prefs.middleC); pitch = String(parts.pitch); octave = String(parts.octave);
    } else if (octave !== '') octave = String(Number(octave) + prefs.middleC - Number(field.dataset.noteMiddle));
    field.dataset.noteMiddle = String(prefs.middleC);
    field.setAttribute('aria-label', translateLabel(field.dataset.noteLabel!));
    const placeholder = input.dataset.batchKey ? t('multiple_values') : t('note_choose');
    pitchSelect.innerHTML = `<option value="" disabled>${escape(placeholder)}</option>` + PITCH_NAMES.map((name, index) =>
      `<option value="${index}" ${octave !== '' && midiNote(index, Number(octave), prefs.middleC) === null ? 'disabled' : ''}>${name}</option>`).join('');
    pitchSelect.value = pitch;
    octaveSelect.innerHTML = `<option value="" disabled>${escape(placeholder)}</option>` + octavesForPitch(pitch === '' ? null : Number(pitch), prefs.middleC)
      .map(value => `<option value="${value}">${value}</option>`).join('');
    octaveSelect.value = octave;
    const names = prefs.inputMode === 'name';
    field.querySelector<HTMLElement>('[data-note-names]')!.hidden = !names;
    field.querySelector<HTMLElement>('[data-note-number-label]')!.hidden = names && (valid || input.value === '');
    pitchSelect.disabled = octaveSelect.disabled = !names;
    const partial = pitch !== '' || octave !== '';
    input.required = !names && !input.dataset.batchKey;
    pitchSelect.required = octaveSelect.required = names && !input.dataset.batchKey;
    input.setCustomValidity('');
    pitchSelect.setCustomValidity(names && partial && pitch === '' ? t('note_complete') : '');
    octaveSelect.setCustomValidity(names && partial && octave === '' ? t('note_complete') : '');
    field.querySelector<HTMLElement>('[data-note-hint]')!.textContent = valid
      ? names ? `MIDI Note ${input.value}` : noteName(Number(input.value), prefs.middleC)
      : input.value === '' && !partial && input.dataset.batchKey ? t('multiple_values') : t('note_invalid');
  }
}

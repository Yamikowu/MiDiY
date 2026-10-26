/** Display-only conventions. MIDI and portable profiles always use integer notes 0–127. */
export type MiddleC = 3 | 4 | 5;
export type NoteInputMode = 'number' | 'name';
export interface NotePreferencesValue { middleC: MiddleC; inputMode: NoteInputMode }
export const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
export const isMidiNote = (value: number) => Number.isInteger(value) && value >= 0 && value <= 127;
export function noteParts(note: number, middleC: MiddleC) {
  if (!isMidiNote(note)) throw new RangeError('MIDI note must be an integer from 0 to 127');
  return { pitch: note % 12, octave: Math.floor(note / 12) + middleC - 5 };
}
export function midiNote(pitch: number, octave: number, middleC: MiddleC): number | null {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 11 || !Number.isInteger(octave)) return null;
  const note = (octave - middleC + 5) * 12 + pitch;
  return isMidiNote(note) ? note : null;
}
export function noteName(note: number, middleC: MiddleC): string {
  const { pitch, octave } = noteParts(note, middleC); return `${PITCH_NAMES[pitch]}${octave}`;
}
export const noteSummary = (note: number, middleC: MiddleC) => `${noteName(note, middleC)} (${note})`;
export function octavesForPitch(pitch: number | null, middleC: MiddleC): number[] {
  return Array.from({ length: 11 }, (_, i) => i + middleC - 5)
    .filter(octave => pitch === null || midiNote(pitch, octave, middleC) !== null);
}
export const NOTE_PREFERENCES_KEY = 'midiy-note-preferences-v1';
interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function parseNotePreferences(raw: unknown): NotePreferencesValue {
  const value = raw as Partial<NotePreferencesValue> | null;
  return { middleC: value?.middleC === 3 || value?.middleC === 5 ? value.middleC : 4,
    inputMode: value?.inputMode === 'name' ? 'name' : 'number' };
}
export class NotePreferences {
  private value: NotePreferencesValue;
  private listeners = new Set<() => void>();
  constructor(private readonly storage?: PreferenceStorage) {
    let raw: unknown;
    try { raw = JSON.parse(storage?.getItem(NOTE_PREFERENCES_KEY) ?? 'null'); } catch { /* Use defaults. */ }
    this.value = parseNotePreferences(raw);
  }
  get current() { return { ...this.value }; }
  update(patch: Partial<NotePreferencesValue>) {
    const next = parseNotePreferences({ ...this.value, ...patch });
    if (next.middleC === this.value.middleC && next.inputMode === this.value.inputMode) return;
    this.value = next;
    try { this.storage?.setItem(NOTE_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* In-memory switching remains available. */ }
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}

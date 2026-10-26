import { mountTesting } from '../../research/testing-ui.js';
import type { ControllerInput, MidiOutput } from '../../runtime/contracts';
import { NotePreferences } from '../../shared/notes/note-format';
import { MikroDriver } from './driver';
import { ProfileLibrary } from './mapping/profile-library';
import { TranslatorUI } from './mapping/translator-ui';
import { mikroResearch } from './research';
import { TranslatorRuntime } from './runtime';

/** The browser shell supplies I/O and storage; this entry assembles one Mikro. */
export function mountMikro({ input, output, storage, toast }: {
  input: ControllerInput;
  output: MidiOutput;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  toast: (message: string) => void;
}) {
  const driver = new MikroDriver();
  const library = new ProfileLibrary(storage);
  const runtime = new TranslatorRuntime(input, output, driver, library.current);
  const mapping = new TranslatorUI(runtime, library, { toast, notePreferences: new NotePreferences(storage) });
  mountTesting(runtime, toast, mikroResearch);
  return { runtime, mapping };
}

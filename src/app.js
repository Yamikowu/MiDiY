import { NotePreferences } from './mapping/note-format';
import { t, onLocaleChange, formatError, initializeLocale, mountLanguageSwitcher } from './i18n/index';
import { TranslatorRuntime } from './runtime/translator-runtime';
import { MikroDriver } from './devices/mikro-mk3/driver';
import { WebHidAdapter } from './adapters/input/web-hid';
import { WebMidiAdapter } from './adapters/output/web-midi';
import { ProfileLibrary } from './mapping/profile-library';
import { TranslatorUI } from './mapping/translator-ui';
import { mountTesting } from './research/testing-ui.js';
import { mountPages } from './shared/pages';

const $ = id => document.getElementById(id);
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 4000);
}
const browserStorage = (() => {
  try { return localStorage; }
  catch { return { getItem: () => null, setItem: () => { throw new Error('Browser storage unavailable'); } }; }
})();
initializeLocale(browserStorage, navigator.languages);
mountLanguageSwitcher();
const library = new ProfileLibrary(browserStorage);
const driver = new MikroDriver();
const runtime = new TranslatorRuntime(new WebHidAdapter(driver.definition.input), new WebMidiAdapter(), driver, library.current);
new TranslatorUI(runtime, library, { toast, notePreferences: new NotePreferences(browserStorage) });
mountTesting(runtime, toast);
mountPages();
runtime.subscribe(event => {
  if (event.type === 'error') toast(formatError(event));
  if (event.type === 'disconnected') toast(t('device_disconnected_midi_notes_have_been_released'));
  if (event.type === 'state') renderConnection(event.state);
});
$('connect').addEventListener('click', async () => {
  try { if (await runtime.connect()) toast(t('device_connected_midi_translation_and_raw_report_analysis_are_both_avail')); }
  catch (error) { toast(t('connection_failed', {p0: formatError(error)})); }
});
$('disconnect').addEventListener('click', () => { void runtime.disconnect().catch(error => toast(t('could_not_close_device', {p0: formatError(error)}))); });
window.addEventListener('pagehide', () => { void runtime.disconnect().catch(() => {}); });
document.addEventListener('keydown', event => {
  const button = event.target.closest('.file-button');
  if (button && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); button.querySelector('input[type="file"]')?.click();
  }
});

function renderConnection(state) {
  const device = state.device;
  $('device-status').textContent = device ? t('connected', {p0: device.productName || driver.definition.name}) : t('disconnected');
  $('device-status').classList.toggle('connected', Boolean(device));
  $('connect').disabled = Boolean(device); $('disconnect').disabled = !device;
}
onLocaleChange(() => { renderConnection(runtime.snapshot); $('toast').classList.remove('visible'); });

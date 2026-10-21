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
const library = new ProfileLibrary(localStorage);
const driver = new MikroDriver();
const runtime = new TranslatorRuntime(new WebHidAdapter(driver.definition.input), new WebMidiAdapter(), driver, library.current);
new TranslatorUI(runtime, library, { toast });
mountTesting(runtime, toast);
mountPages();
runtime.subscribe(event => {
  if (event.type === 'error') toast(event.message);
  if (event.type === 'disconnected') toast('裝置已拔除；已釋放 MIDI 音符。');
  if (event.type === 'state') {
    const device = event.state.device;
    $('device-status').textContent = device ? `● 已連線 ${device.productName || driver.definition.name}` : '● 尚未連線';
    $('device-status').classList.toggle('connected', Boolean(device));
    $('connect').disabled = Boolean(device); $('disconnect').disabled = !device;
  }
});
$('connect').addEventListener('click', async () => {
  try { if (await runtime.connect()) toast('已連接裝置。MIDI 轉譯與原始報告分析可同時使用。'); }
  catch (error) { toast(`連接失敗：${error.message}`); }
});
$('disconnect').addEventListener('click', () => { void runtime.disconnect().catch(error => toast(`關閉裝置失敗：${error.message}`)); });
window.addEventListener('pagehide', () => { void runtime.disconnect().catch(() => {}); });
document.addEventListener('keydown', event => {
  const button = event.target.closest('.file-button');
  if (button && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); button.querySelector('input[type="file"]')?.click();
  }
});

import {
  MODE_SELECTOR_BUTTONS, PAD_VELOCITY_CURVES
} from '@midiy/mikro-core';
import { attribute, l, labelAttributes, t } from '../../../i18n/index';

import { controlName, html } from './view-helpers';
export interface WorkspaceMarkupContext {
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
}

export function mountMarkup(ctx: WorkspaceMarkupContext): void {
  ctx.el('panel').innerHTML = `
      <section class="config-panel" ${attribute('aria-label', 'profiles_modes')}>
        <div class="config-row profile-config-row">
          <label class="config-picker"><span class="config-picker-heading">${l('profile')}<span id="midi-save-status" class="save-status" role="status"></span></span><select id="midi-library" ${attribute('aria-label', 'select_profile')}></select><input id="midi-profile-name" maxlength="80" ${attribute('aria-label', 'edit_profile_name')} hidden></label>
          <div class="config-actions"><button id="midi-profile-edit" class="outline" ${attribute('aria-label', 'edit')} ${attribute('title', 'edit')}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3ZM14 5l5 5"/></svg></button><button id="midi-profile-duplicate" class="outline" ${attribute('aria-label', 'duplicate')} ${attribute('title', 'duplicate')}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg></button><button id="midi-profile-new" class="outline" ${attribute('aria-label', 'add_profile')}>＋</button><button id="midi-save" class="rename-save" ${attribute('aria-label', 'save')} hidden>✔</button><button id="midi-profile-cancel" class="outline" ${attribute('aria-label', 'cancel')} hidden>✕</button><button id="midi-profile-delete" class="text-button danger delete-icon" ${attribute('aria-label', 'delete')} hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg></button></div>
          <label class="profile-velocity" title="${html(t('applies_to_pad_hit_velocity_across_this_profile_and_saves_immediately_so'))}">${l('pad_velocity_curve')}<select id="midi-pad-velocity-curve">${PAD_VELOCITY_CURVES.map(value => `<option value="${value}">${value === 'linear' ? 'Linear' : value.replace('-', ' ').replace(/^./, c => c.toUpperCase())}</option>`).join('')}</select></label>
          <div class="profile-file-actions"><button id="midi-export" class="text-button">${l('export')}</button><label class="text-button file-button" tabindex="0" role="button">${l('import')}<input id="midi-import" type="file" accept=".json,application/json" hidden></label></div>
        </div>
        <div class="config-row mode-config-row">
          <label class="config-picker"><span class="config-picker-heading">Mode<span id="midi-playing-mode" class="mode-shortcut"></span></span><select id="midi-mode" ${attribute('aria-label', 'select_mode')}></select><input id="midi-mode-name" maxlength="80" ${attribute('aria-label', 'edit_mode_name')} hidden></label>
          <div class="config-actions"><button id="midi-mode-edit" class="outline" ${attribute('aria-label', 'edit')} ${attribute('title', 'edit')}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3ZM14 5l5 5"/></svg></button><button id="midi-add-mode" class="outline" ${attribute('aria-label', 'duplicate')} ${attribute('title', 'duplicate')}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg></button><button id="midi-mode-new" class="outline" ${attribute('aria-label', 'add_mode')}>＋</button><button id="midi-mode-save" class="rename-save" ${attribute('aria-label', 'save')} hidden>✔</button><button id="midi-mode-cancel" class="outline" ${attribute('aria-label', 'cancel')} hidden>✕</button><button id="midi-delete-mode" class="text-button danger delete-icon" ${attribute('aria-label', 'delete')} hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg></button></div>
          <label class="switch default-switch"><input id="midi-initial" type="checkbox">${l('set_as_startup_mode', {})}</label>
          <label class="mode-selector-setting"><span class="config-picker-heading">${l('mode_selector_key')}<span id="midi-mode-shortcut" class="mode-shortcut"></span></span><select id="midi-mode-selector">${MODE_SELECTOR_BUTTONS.map(id => `<option value="${id}" ${labelAttributes(controlName(id))}>${html(controlName(id))}</option>`).join('')}</select></label>
        </div>
      </section>
      <div class="workspace mapping-workspace">
        <section class="panel mapping-device">
          <div class="section-heading mapping-controller-heading">

            <div class="map-footer mapping-legend"><span><i class="dot selected-dot"></i>${l('selected', {})}</span><span><i class="dot mapped-dot"></i><span id="midi-legend-mapped">${l('mapped', {})}</span></span><span><i class="dot idle-dot"></i><span id="midi-legend-unmapped">${l('unmapped', {})}</span></span></div>
            <span id="midi-mapped-count" class="section-note"></span>
          </div>
          <div class="hardware-scroll"><div id="midi-hardware" class="hardware" ${attribute('aria-label', 'mapping_controller_reference', {})}></div></div>
          <div class="mapping-footer-row">
          <p class="map-hint" title="${html(t('selection_shortcuts_hint'))}">${l('selection_shortcuts_compact', {})}</p>
          <div class="mapping-edit-actions" role="toolbar" ${attribute('aria-label', 'mapping_edit_actions', {})}>
            <button id="midi-undo" type="button">${l('undo_edit', {})}</button><button id="midi-redo" type="button">${l('redo_edit', {})}</button>
            <button id="midi-copy-controls" type="button">${l('copy_controls', {})}</button><button id="midi-paste-controls" type="button">${l('paste_controls', {})}</button>
            <span id="midi-selection-count"></span>
            <label class="switch hardware-follow-toggle" title="${html(t('follow_hardware_selection_help'))}"><input id="midi-follow-hardware-selection" type="checkbox">${l('follow_hardware_selection', {})}</label>
          </div>
          </div>
          <div id="midi-note-preferences" class="note-preferences" hidden>
            <label>${l('note_octave_reference')}<select id="midi-note-octave">${[3, 4, 5].map(o => `<option value="${o}">Note 60 = C${o}</option>`).join('')}</select></label>
            <label>${l('note_input_method')}<select id="midi-note-input-mode"><option value="number" data-i18n="note_number_mode">${t('note_number_mode')}</option><option value="name" data-i18n="note_name_mode">${t('note_name_mode')}</option></select></label>
          </div>
        </section>
        <aside class="panel mapping-editor" ${attribute('aria-label', 'control_editor', {})}>
          <div class="inspector-tabs" role="tablist" ${attribute('aria-label', 'inspector_settings')}>
            <button id="midi-mode-tab" role="tab" aria-controls="midi-mode-inspector" aria-selected="false" tabindex="-1">${l('mode_settings')}</button>
            <button id="midi-control-tab" role="tab" aria-controls="midi-control-inspector" aria-selected="true">${l('control_settings')}</button>
          </div>
          <section id="midi-mode-inspector" role="tabpanel" aria-labelledby="midi-mode-tab" hidden>
            <h2 id="midi-mode-title"></h2>
            <div class="mode-fields">
              <label>${l('mode_trigger')}<div class="mode-trigger-picker"><select id="midi-mode-trigger" ${attribute('aria-label', 'mode_trigger')}></select><button id="midi-clear-trigger" type="button" class="text-button" ${attribute('aria-label', 'clear_mode_trigger')} ${attribute('title', 'clear_mode_trigger')}>✕</button></div></label>
              <label>${l('mode_color')}<select id="midi-mode-color" ${attribute('aria-label', 'mode_color')}></select></label>
            </div>
            <p id="midi-mode-selection-status" class="caption" role="status"></p>
            <div class="device-settings">          <details class="device-options" open><summary>${l('device_lights', {})}<span id="midi-led-summary">${l('not_controlled', {})}</span></summary>
            <p id="midi-led-status" class="caption" role="status"></p>
            <p class="editor-section-label settings-scope">${l('shared_brightness_for_this_mode')}</p>
            <div class="led-settings">
              <fieldset class="brightness-pair"><legend>${l('button_gate_lights')}</legend>
                <label>${l('idle_brightness')}<select id="midi-button-idle-brightness" ${attribute('aria-label', 'button_idle_brightness')}></select></label>
                <label>${l('held_brightness')}<select id="midi-button-on-brightness" ${attribute('aria-label', 'button_pressed_brightness')}></select></label>
              </fieldset>
              <fieldset class="brightness-pair"><legend>${l('button_toggle_lights')}</legend>
                <label>${l('off_brightness')}<select id="midi-toggle-button-off-brightness" ${attribute('aria-label', 'toggle_button_off_brightness')}></select></label>
                <label>${l('on_brightness')}<select id="midi-toggle-button-on-brightness" ${attribute('aria-label', 'toggle_button_on_brightness')}></select></label>
              </fieldset>
              <fieldset class="brightness-pair"><legend>${l('all_pads')}</legend>
                <label>${l('idle_brightness')}<select id="midi-pad-off-brightness" ${attribute('aria-label', 'idle_brightness_for_all_16_pads')}></select></label>
                <label>${l('pressed_brightness')}<select id="midi-pad-on-brightness" ${attribute('aria-label', 'pressed_brightness_for_all_16_pads')}></select></label>
              </fieldset>
            </div>
            <p class="caption">${l('changes_save_immediately_to_this_mode_button_brightness_only_affects_map', {})}</p>
          </details>
<p class="caption device-shortcuts">${l('led_takeover_shortcut')}</p></div>
          </section>
          <section id="midi-control-inspector" role="tabpanel" aria-labelledby="midi-control-tab">
          <div class="editor-heading"><p class="eyebrow">CONTROL INSPECTOR</p><span id="midi-draft-state" class="draft-state" role="status">${l('applied', {})}</span></div>
          <h2 id="midi-selected">Pad 1</h2><p id="midi-binding-summary" class="binding-summary"></p>
          <form id="midi-binding-form">
            <div id="midi-pad-tabs" class="inspector-tabs pad-binding-tabs" role="tablist" ${attribute('aria-label', 'control_binding_tabs')} hidden>
              <button id="midi-hit-tab" type="button" role="tab" aria-controls="midi-hit-panel" aria-selected="true">${l('pad_hit_tab')}</button>
              <button id="midi-press-tab" type="button" role="tab" aria-controls="midi-pad-press" aria-selected="false" tabindex="-1">${l('pad_press_tab')}</button>
              <button id="midi-position-tab" type="button" role="tab" aria-controls="midi-hit-panel" aria-selected="true" hidden>${l('strip_position_tab')}</button>
              <button id="midi-touch-tab" type="button" role="tab" aria-controls="midi-strip-touch" aria-selected="false" tabindex="-1" hidden>${l('strip_touch_tab')}</button>
            </div>
            <section id="midi-hit-panel" role="tabpanel" aria-labelledby="midi-hit-tab">
              <div id="midi-hit-heading" class="editor-section-label">MIDI OUTPUT</div><label>${l('output_action', {})}<select id="midi-action"></select></label>
              <div id="midi-fields" class="binding-fields"></div>
            </section>
            <div id="midi-pad-press" class="binding-fields" role="tabpanel" aria-labelledby="midi-press-tab" hidden></div>
            <div id="midi-strip-touch" class="binding-fields" role="tabpanel" aria-labelledby="midi-touch-tab" hidden></div>
            <div id="midi-pad-light" class="binding-fields"></div>
            <button id="midi-apply" class="primary wide" type="submit">${l('apply_to_current_mode', {})}</button>
          </form>
          <p id="midi-binding-help" class="caption"></p>
          </section>
        </aside>
      </div>
      <div class="mapping-status"><span id="midi-status" role="status">${l('no_midi_output_selected', {})}</span><span>${l('profiles_are_saved_in_this_browser_export_as_json', {})}</span></div>`;
}


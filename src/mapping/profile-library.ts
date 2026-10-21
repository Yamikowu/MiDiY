import { createDefaultProfile, parseProfile, type Profile } from '@midiy/mikro-core';

const ACTIVE_KEY = 'midiy-profile-v1';
const LIBRARY_KEY = 'midiy-profile-library-v1';
const LEGACY_ACTIVE_KEY = 'mpa-profile-v1';
const LEGACY_LIBRARY_KEY = 'mpa-profile-library-v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export interface SavedProfile { id: string; profile: Profile }
interface Library { schema: string; activeId: string; entries: SavedProfile[] }

/** Browser library metadata stays outside the portable profile format. */
export class ProfileLibrary {
  entries: SavedProfile[] = [];
  activeId = '';
  warning = '';
  persisted = false;
  constructor(private readonly storage: StorageLike) {
    for (const key of [LIBRARY_KEY, LEGACY_LIBRARY_KEY]) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw) as Library;
        if (data.schema !== key || !Array.isArray(data.entries) || !data.entries.length) throw new Error('Invalid library');
        const entries = data.entries.map(e => {
          if (!e || typeof e.id !== 'string' || !e.id) throw new Error('Invalid entry');
          return { id: e.id, profile: parseProfile(e.profile) };
        });
        if (new Set(entries.map(e => e.id)).size !== entries.length || !entries.some(e => e.id === data.activeId)) throw new Error('Invalid active profile');
        this.entries = entries; this.activeId = data.activeId; this.persisted = true; return;
      } catch { this.warning = '設定檔清單無法讀取，已嘗試載入原有 MIDI 設定。'; }
    }
    let profile = createDefaultProfile();
    for (const key of [ACTIVE_KEY, LEGACY_ACTIVE_KEY]) {
      try {
        const raw = storage.getItem(key);
        if (raw) { profile = parseProfile(JSON.parse(raw)); this.persisted = true; break; }
      } catch { this.warning = '原有 MIDI 設定無法讀取，已嘗試其他設定。'; }
    }
    this.entries = [{ id: 'legacy', profile }]; this.activeId = 'legacy';
  }
  get current(): Profile { return parseProfile(this.entries.find(e => e.id === this.activeId)!.profile); }
  save(profile: Profile, asCopy = false): void {
    const next = parseProfile(profile), id = asCopy || !this.activeId ? crypto.randomUUID() : this.activeId;
    const entries = this.entries.filter(e => e.id !== id).concat({ id, profile: next });
    this.persist(entries, id);
  }
  select(id: string): Profile {
    if (!this.entries.some(e => e.id === id)) throw new Error('找不到設定檔');
    this.persist(this.entries, id); return this.current;
  }
  deleteActive(): Profile {
    if (this.entries.length <= 1) throw new Error('至少保留一份設定檔');
    const index = this.entries.findIndex(e => e.id === this.activeId);
    const entries = this.entries.filter(e => e.id !== this.activeId);
    this.persist(entries, entries[Math.min(index, entries.length - 1)].id);
    return this.current;
  }
  private persist(entries: SavedProfile[], activeId: string): void {
    // Write the authoritative library before the active-profile mirror.
    this.storage.setItem(LIBRARY_KEY, JSON.stringify({ schema: LIBRARY_KEY, entries, activeId }));
    this.entries = entries; this.activeId = activeId; this.persisted = true;
    this.storage.setItem(ACTIVE_KEY, JSON.stringify(this.current));
  }
}

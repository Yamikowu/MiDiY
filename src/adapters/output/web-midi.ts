import type { MidiMessage } from '@midiy/mikro-core';
import type { MidiOutput, MidiStatus } from '../../runtime/contracts';

export class WebMidiAdapter implements MidiOutput {
  access: WebMidi.MIDIAccess | null = null;
  output: WebMidi.MIDIOutput | null = null;
  private generation = 0;
  private selection: Promise<void> = Promise.resolve();
  private change: () => void = () => {};
  private lost: () => MidiMessage[] = () => [];
  bind(change: () => void, lost: () => MidiMessage[]) { this.change = change; this.lost = lost; }
  get status(): MidiStatus {
    const port = (p: WebMidi.MIDIOutput) => ({ id: p.id, name: p.name || p.id });
    return { enabled: Boolean(this.access),
      ports: [...this.access?.outputs.values() ?? []].filter(p => p.state === 'connected').map(port),
      output: this.output ? port(this.output) : null };
  }
  constructor(private readonly request: (() => Promise<WebMidi.MIDIAccess>) | undefined =
      typeof navigator !== 'undefined' && navigator.requestMIDIAccess ? () => navigator.requestMIDIAccess() : undefined) {}
  async enable(): Promise<void> {
    if (!this.request) throw new Error('此瀏覽器不支援 Web MIDI');
    if (this.access) { this.change(); return; }
    this.access = await this.request();
    this.access.addEventListener('statechange', () => {
      if (this.output?.state === 'disconnected') {
        // Best effort; disconnected endpoints may already reject the final Note Off.
        const finalMessages = this.lost();
        try { for (const message of finalMessages) this.output.send(message); } catch { /* endpoint already gone */ }
        this.output = null; this.generation++;
      }
      this.change();
    });
    this.change();
  }
  select(id: string, finalMessages: MidiMessage[]): Promise<void> {
    const generation = ++this.generation;
    this.send(finalMessages);
    const previous = this.output; this.output = null;
    const task = this.selection.catch(() => {}).then(async () => {
      if (previous) await previous.close();
      if (generation !== this.generation) return;
      if (!id) { this.change(); return; }
      const next = this.access?.outputs.get(id);
      if (!next || next.state !== 'connected') throw new Error('MIDI 輸出埠已離線');
      await next.open();
      if (generation !== this.generation) { await next.close(); return; }
      this.output = next; this.change();
    });
    this.selection = task;
    return task;
  }
  send(messages: readonly MidiMessage[]): void {
    if (!this.output) return;
    try { for (const message of messages) this.output.send(message); }
    catch (error) {
      this.output = null; this.generation++;
      this.lost(); this.change(); throw error;
    }
  }
}

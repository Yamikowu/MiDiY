/** Coalesce display work only. Callers keep data collection and I/O synchronous. */
export class FrameTask {
  private pending: number | null = null;
  constructor(private readonly run: () => void,
    private readonly schedule: (callback: () => void) => number,
    private readonly unschedule: (id: number) => void) {}
  request(): void {
    if (this.pending !== null) return;
    this.pending = this.schedule(() => { this.pending = null; this.run(); });
  }
  cancel(): void {
    if (this.pending === null) return;
    this.unschedule(this.pending); this.pending = null;
  }
}

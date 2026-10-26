import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameTask } from '../src/shared/frame-task';

function clock(run: () => void) {
  let id = 0; const callbacks = new Map<number, () => void>();
  const task = new FrameTask(run, callback => { callbacks.set(++id, callback); return id; }, id => { callbacks.delete(id); });
  const paint = () => { const queued = [...callbacks.values()]; callbacks.clear(); for (const callback of queued) callback(); };
  return { task, callbacks, paint };
}
test('many display requests paint once with all synchronously collected data, and can schedule the next frame', () => {
  const reports: number[] = [], painted: number[][] = [];
  const { task, callbacks, paint } = clock(() => painted.push([...reports]));
  for (let i = 0; i < 240; i++) { reports.push(i); task.request(); }
  assert.equal(reports.length, 240); assert.equal(callbacks.size, 1); assert.deepEqual(painted, []);
  paint(); assert.deepEqual(painted, [reports]);
  reports.push(240); task.request(); paint(); assert.equal(painted[1].length, 241);
});
test('cancel prevents an outdated queued paint after clear, reset or disposal; later requests still work', () => {
  let paints = 0; const { task, callbacks, paint } = clock(() => paints++);
  task.request(); task.cancel(); task.cancel(); assert.equal(callbacks.size, 0);
  paint(); assert.equal(paints, 0);
  task.request(); paint(); assert.equal(paints, 1);
});
test('a failed paint does not leave display scheduling stuck', () => {
  let fail = true, paints = 0;
  const { task, paint } = clock(() => { if (fail) throw Error('view failed'); paints++; });
  task.request(); assert.throws(paint); fail = false;
  task.request(); paint(); assert.equal(paints, 1);
});

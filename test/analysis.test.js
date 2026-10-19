import test from 'node:test';
import assert from 'node:assert/strict';
import { changedBytes, summarizeCapture, normalizeImport } from '../src/analysis.js';
import { controls } from '../src/controls.js';

test('Mikro MK3 control list has unique physical targets', () => {
  assert.equal(controls.length, 58);
  assert.equal(new Set(controls.map(control => control.id)).size, controls.length);
});

test('changed bytes use zero-based offsets and preserve missing bytes', () => {
  assert.deepEqual(changedBytes([0, 1, 2], [0, 3]), [
    { offset: 1, before: 1, after: 3 },
    { offset: 2, before: 2, after: null }
  ]);
});

test('capture summary compares first sample with baseline for the same report ID', () => {
  const summary = summarizeCapture({
    baseline: { 1: [0, 0], 2: [8] },
    samples: [
      { reportId: 1, bytes: [0, 5] },
      { reportId: 2, bytes: [9] },
      { reportId: 1, bytes: [0, 0] }
    ]
  });
  assert.deepEqual(summary, [
    { reportId: 1, offset: 1, count: 2, values: [0, 5], range: [0, 5] },
    { reportId: 2, offset: 0, count: 1, values: [9], range: [9, 9] }
  ]);
});

test('reject invalid imported report bytes', () => {
  assert.throws(() => normalizeImport({ schema: 'mpa-session-v1', captures: [], reports: [{ reportId: 1, bytes: [300] }] }));
});

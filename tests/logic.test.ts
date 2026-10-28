import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/data';
import { subprocessRef } from '../src/logic';

describe('Bench-Suite example benchmark seed', () => {
  it('creates one example case, seven processes, 65 subprocesses, and a blank assessment for each step', () => {
    const state = createSeedState();
    expect(state.insurers).toHaveLength(1);
    expect(state.insurers[0]?.name).toBe('example-insurer');
    expect(state.processes).toHaveLength(7);
    expect(state.subprocesses).toHaveLength(65);
    expect(state.assessments).toHaveLength(65);
    expect(state.assessments.every((item) => item.existence === 'Not Assessed' && item.automation === 'Unknown')).toBe(true);
    expect(state.painPoints).toHaveLength(0);
    expect(state.connections).toHaveLength(0);
    expect(new Set(state.assessments.map((item) => item.id)).size).toBe(state.assessments.length);
  });

  it('derives readable subprocess references from current order', () => {
    const state = createSeedState();
    expect(subprocessRef(state.processes, state.subprocesses, state.subprocesses[0]!.id)).toBe('1.1');
    expect(subprocessRef(state.processes, state.subprocesses, state.subprocesses[7]!.id)).toBe('2.1');
  });
});
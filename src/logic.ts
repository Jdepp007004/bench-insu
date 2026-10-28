import type { Assessment, Confidence, PainPoint, Process, Subprocess, WorkspaceState } from './types';

export function processNumber(processes: Process[], id: string): number {
  return processes.filter((process) => !process.archived).sort((a, b) => a.order - b.order).findIndex((process) => process.id === id) + 1;
}

export function subprocessRef(processes: Process[], subprocesses: Subprocess[], id: string): string {
  const sub = subprocesses.find((item) => item.id === id);
  if (!sub) return '—';
  const siblings = subprocesses.filter((item) => item.processId === sub.processId && !item.archived).sort((a, b) => a.order - b.order);
  return `${processNumber(processes, sub.processId)}.${siblings.findIndex((item) => item.id === id) + 1}`;
}

const severityWeight: Record<PainPoint['severity'], number> = { Critical: 1, High: 0.8, Medium: 0.55, Low: 0.3 };
const confidenceWeight: Record<Confidence, number> = { High: 1, Medium: 0.8, Low: 0.6, Unverified: 0.45 };

/** Unknown assessments stay unscored. Opportunity scores require evidence-supported or confirmed pain points. */
export function priorityScore(assessment: Assessment | undefined, points: PainPoint[]): number | null {
  if (!assessment || assessment.existence === 'Not Assessed') return null;
  const supported = points.filter((point) => point.validation === 'Evidence Supported' || point.validation === 'Confirmed');
  if (!supported.length) return null;
  const gapWeight = assessment.existence === "Doesn't Exist" ? 1 : assessment.existence === 'Partially Exists' ? 0.7 : 0.35;
  const best = Math.max(...supported.map((point) => {
    const severity = severityWeight[point.severity];
    const impact = Math.min(1, Math.max(1, point.businessImpact || 1) / 5);
    const frequency = Math.min(1, Math.max(1, point.frequency || 1) / 5);
    const effort = Math.min(1, Math.max(1, point.manualEffortHours || 1) / 40);
    return (0.45 * severity + 0.25 * impact + 0.2 * frequency + 0.1 * effort) * confidenceWeight[point.confidence] * gapWeight * 100;
  }));
  return Math.round(best);
}

export function assessmentFor(state: WorkspaceState, insurerId: string, subprocessId: string) {
  return state.assessments.find((item) => item.insurerId === insurerId && item.subprocessId === subprocessId);
}

export function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  items.forEach((item) => result.set(key(item), (result.get(key(item)) ?? 0) + 1));
  return result;
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

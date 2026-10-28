export type ExistenceStatus = 'Exists' | 'Partially Exists' | "Doesn't Exist" | 'Not Assessed';
export type AutomationLevel = 'Fully Automated' | 'Partially Automated' | 'Manual' | 'Unknown';
export type Confidence = 'High' | 'Medium' | 'Low' | 'Unverified';
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';
export type ValidationStatus = 'Hypothesis' | 'Evidence Supported' | 'Confirmed' | 'Resolved' | 'Rejected';

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export interface Insurer {
  id: string;
  name: string;
  category: 'Standalone Health Insurer' | 'Private General Insurer' | 'Public-Sector General Insurer' | 'Other';
  website: string;
  description: string;
  ghiAvailability: 'Unknown' | 'Available' | 'Unavailable';
  researchStatus: 'Not Started' | 'In Progress' | 'Under Review' | 'Completed';
  lastReviewed: string | null;
  researchOwner: string;
  notes: string;
}

export interface Process {
  id: string;
  name: string;
  description: string;
  order: number;
  archived: boolean;
}

export interface Subprocess {
  id: string;
  processId: string;
  name: string;
  description: string;
  order: number;
  archived: boolean;
}

export interface Assessment {
  id: string;
  insurerId: string;
  subprocessId: string;
  existence: ExistenceStatus;
  confidence: Confidence;
  technologyCategory: string;
  vendor: string;
  automation: AutomationLevel;
  notes: string;
  verifiedAt: string | null;
  updatedAt: string | null;
  owner: string;
}

export interface PainPoint {
  id: string;
  insurerId: string;
  subprocessId: string;
  title: string;
  description: string;
  failureScenario: string;
  rootCause: string;
  consequence: string;
  businessImpact: number;
  frequency: number;
  severity: Severity;
  manualEffortHours: number;
  workaround: string;
  proposedSolution: string;
  confidence: Confidence;
  validation: ValidationStatus;
  sourceReferences: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowConnection {
  id: string;
  insurerId: string;
  sourceId: string;
  targetId: string;
  label: string;
  type: 'Data transfer' | 'Manual handoff' | 'Decision dependency' | 'System integration' | 'Other';
  reliability: 'Reliable' | 'Partially Reliable' | 'Unreliable' | 'Unknown';
  notes: string;
}

export interface EvidenceItem {
  id: string;
  insurerId: string;
  subprocessId: string | null;
  title: string;
  sourceType: 'Insurer website' | 'Policy document' | 'Regulatory filing' | 'Interview' | 'Product demo' | 'Other';
  url: string;
  excerpt: string;
  confidence: Confidence;
  capturedAt: string;
  capturedBy: string;
}

export interface HistoryEntry {
  id: string;
  entityType: 'assessment' | 'pain point' | 'process' | 'subprocess' | 'connection' | 'evidence' | 'insurer';
  entityId: string;
  insurerId: string | null;
  summary: string;
  actor: string;
  at: string;
}

export interface WorkspaceState {
  schemaVersion: 1;
  insurers: Insurer[];
  processes: Process[];
  subprocesses: Subprocess[];
  assessments: Assessment[];
  painPoints: PainPoint[];
  connections: WorkflowConnection[];
  evidence: EvidenceItem[];
  history: HistoryEntry[];
}

export type SectionId = 'overview' | 'insurers' | 'lifecycle' | 'pain-points' | 'graph' | 'comparison' | 'opportunities' | 'evidence' | 'settings';

export const EXISTENCE_OPTIONS: ExistenceStatus[] = ['Exists', 'Partially Exists', "Doesn't Exist", 'Not Assessed'];
export const AUTOMATION_OPTIONS: AutomationLevel[] = ['Fully Automated', 'Partially Automated', 'Manual', 'Unknown'];
export const CONFIDENCE_OPTIONS: Confidence[] = ['High', 'Medium', 'Low', 'Unverified'];
export const SEVERITY_OPTIONS: Severity[] = ['Critical', 'High', 'Medium', 'Low'];
export const VALIDATION_OPTIONS: ValidationStatus[] = ['Hypothesis', 'Evidence Supported', 'Confirmed', 'Resolved', 'Rejected'];

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

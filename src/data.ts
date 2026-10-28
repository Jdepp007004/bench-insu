import { newId, type Insurer, type Process, type Subprocess, type WorkspaceState } from './types';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const insurers: Insurer[] = [{
  id: 'example-insurer', name: 'example-insurer', category: 'Other', website: '', description: 'Illustrative benchmark case.',
  ghiAvailability: 'Unknown', researchStatus: 'Not Started', lastReviewed: null, researchOwner: '', notes: 'Example data only.',
}];

const lifecycle: Array<[string, string, string[]]> = [
  ['Employer Discovery & Quotation', 'From employer requirements through quote approval.', [
    'Employer requirement collection', 'Employee census intake', 'Risk and historical claims analysis', 'Coverage configuration', 'Insurer quotation generation', 'Premium negotiation', 'Final quotation approval',
  ]],
  ['Underwriting & Policy Issuance', 'Group assessment, pricing, payment and policy documents.', [
    'Proposal validation', 'Group eligibility assessment', 'Underwriting rules evaluation', 'Premium calculation', 'Payment confirmation', 'Master policy generation', 'Policy document and schedule dispatch',
  ]],
  ['Employee Enrollment & Endorsements', 'Member ingestion, validation, enrollment and policy changes.', [
    'HRMS / employer data ingestion', 'Employee data validation', 'Dependent eligibility validation', 'Member enrollment', 'Member additions', 'Member deletions', 'Corrections and modifications', 'Effective-date validation', 'Premium adjustment reconciliation', 'E-card generation and delivery',
  ]],
  ['Cashless Pre-authorisation', 'Hospital intake through pre-authorisation decision and communication.', [
    'Hospital claim intimation', 'Member eligibility verification', 'Policy coverage verification', 'Medical-document collection', 'Document extraction and validation', 'Clinical necessity evaluation', 'Fraud and anomaly screening', 'Pre-authorisation decision', 'Hospital query and clarification', 'Approval communication',
  ]],
  ['Claims Adjudication & Settlement', 'Final claim review, settlement decision and payment.', [
    'Final claim submission', 'Document completeness validation', 'Medical bill extraction', 'Diagnosis and procedure validation', 'Policy exclusions and coverage checks', 'Co-payment and deductible calculation', 'Hospital tariff reconciliation', 'Fraud and anomaly analysis', 'Human adjudicator review', 'Final settlement calculation', 'Claim approval or rejection', 'Payment execution', 'Settlement communication',
  ]],
  ['Customer Servicing & Grievances', 'Service, escalation, complaint resolution and reporting.', [
    'Claim status tracking', 'Customer support intake', 'Automated query resolution', 'Manual escalation', 'Complaint registration', 'Grievance investigation', 'Grievance resolution', 'Regulatory and audit reporting',
  ]],
  ['Reporting & Renewals', 'Experience analysis and employer renewal workflow.', [
    'Claims experience aggregation', 'Claims ratio analysis', 'Utilisation analysis', 'Loss-ratio reporting', 'Endorsement reconciliation', 'Renewal risk assessment', 'Renewal quotation generation', 'Benefits redesign', 'Renewal negotiation', 'Policy renewal confirmation',
  ]],
];

const processes: Process[] = lifecycle.map(([name, description], i) => ({ id: uuid(100 + i), name, description, order: i, archived: false }));
const subprocesses: Subprocess[] = lifecycle.flatMap(([, , steps], pi) => steps.map((name, si) => ({
  id: uuid(200 + pi * 20 + si), processId: processes[pi]!.id, name, description: '', order: si, archived: false,
})));

export function createSeedState(caseName = 'example-insurer'): WorkspaceState {
  const workspaceInsurers = structuredClone(insurers).map((insurer) => ({
    ...insurer,
    id: caseName === 'example-insurer' ? insurer.id : newId(),
    name: caseName,
    description: caseName === 'example-insurer' ? insurer.description : 'Illustrative GHI benchmark workspace.',
  }));
  return {
    schemaVersion: 1, insurers: workspaceInsurers, processes: structuredClone(processes), subprocesses: structuredClone(subprocesses),
    assessments: workspaceInsurers.flatMap((insurer) => subprocesses.map((subprocess, subprocessIndex) => ({
      id: uuid(2_000 + subprocessIndex), insurerId: insurer.id, subprocessId: subprocess.id,
      existence: 'Not Assessed' as const, confidence: 'Unverified' as const, technologyCategory: '', vendor: '', automation: 'Unknown' as const,
      notes: '', verifiedAt: null, updatedAt: null, owner: '',
    }))),
    painPoints: [], connections: [], evidence: [], history: [],
  };
}

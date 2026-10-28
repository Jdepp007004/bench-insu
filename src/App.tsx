import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, BookOpenText, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Download, FileText, Filter, GitBranch,
  GitBranchPlus, Layers3, LayoutDashboard, ListFilter, LoaderCircle, LogOut, Menu, MoreHorizontal, Plus,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, Upload, Workflow,
  X,
} from 'lucide-react';
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Connection, type Edge,
  type Node, type NodeProps, type NodeTypes,
} from '@xyflow/react';
import { assessmentFor, csvEscape, priorityScore, subprocessRef } from './logic';
import {
  getCurrentUser, loadWorkspace, remoteEnabled, saveWorkspace, signIn, signOut, sourceLabel, subscribeWorkspace,
  type WorkspaceSnapshot,
} from './storage';
import {
  AUTOMATION_OPTIONS, CONFIDENCE_OPTIONS, EXISTENCE_OPTIONS, SEVERITY_OPTIONS, VALIDATION_OPTIONS, newId,
  type Assessment, type Confidence, type EvidenceItem, type HistoryEntry, type Insurer, type PainPoint,
  type Process, type SectionId, type Subprocess, type User, type WorkflowConnection, type WorkspaceState,
} from './types';

type HistoryType = HistoryEntry['entityType'];
type CommitMeta = { type: HistoryType; id: string; insurerId?: string | null; summary: string };
type Commit = (update: (state: WorkspaceState) => WorkspaceState, meta: CommitMeta) => void;
type Dialog =
  | { kind: 'insurer'; insurer?: Insurer }
  | { kind: 'process'; process?: Process }
  | { kind: 'subprocess'; processId: string; subprocess?: Subprocess }
  | { kind: 'pain'; subprocessId?: string; pain?: PainPoint }
  | { kind: 'evidence'; subprocessId?: string }
  | { kind: 'connection'; sourceId?: string; targetId?: string; connection?: WorkflowConnection };

const nav: Array<{ id: SectionId; label: string; icon: typeof LayoutDashboard; group: string }> = [
  { id: 'lifecycle', label: 'Benchmarking suite', icon: Layers3, group: 'Workspace' },
  { id: 'graph', label: 'Workflow graph', icon: Workflow, group: 'Workspace' },
];

const pageTitles: Record<SectionId, string> = {
  overview: 'Benchmarking suite', insurers: 'Benchmarking suite', lifecycle: 'Benchmarking suite', 'pain-points': 'Pain notes',
  graph: 'Workflow graph', comparison: 'Workflow graph', opportunities: 'Benchmarking suite', evidence: 'Benchmarking suite', settings: 'Workspace',
};

const blankAssessment = (insurerId: string, subprocessId: string): Assessment => ({
  id: newId(), insurerId, subprocessId, existence: 'Not Assessed', confidence: 'Unverified', technologyCategory: '', vendor: '',
  automation: 'Unknown', notes: '', verifiedAt: null, updatedAt: null, owner: '',
});

const emptyAssessment = (insurerId: string, subprocessId: string, user: User): Assessment => ({
  ...blankAssessment(insurerId, subprocessId), updatedAt: new Date().toISOString(), owner: user.displayName,
});

function pushHistory(state: WorkspaceState, meta: CommitMeta, user: User): WorkspaceState {
  const entry: HistoryEntry = {
    id: newId(), entityType: meta.type, entityId: meta.id, insurerId: meta.insurerId ?? null,
    summary: meta.summary, actor: user.displayName, at: new Date().toISOString(),
  };
  return { ...state, history: [entry, ...state.history].slice(0, 500) };
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function nameById(items: Array<{ id: string; name: string }>, id?: string | null) {
  return items.find((item) => item.id === id)?.name ?? 'Unknown';
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function classForStatus(value: string) {
  if (value === 'Exists' || value === 'Confirmed' || value === 'Reliable' || value === 'Completed') return 'green';
  if (value === 'Partially Exists' || value === 'Evidence Supported' || value === 'Under Review') return 'amber';
  if (value === "Doesn't Exist" || value === 'Critical' || value === 'High' || value === 'Unreliable') return 'red';
  if (value === 'Hypothesis' || value === 'In Progress') return 'blue';
  return 'gray';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const stateRef = useRef<WorkspaceState | null>(null);
  const revisionRef = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [activePage, setActivePage] = useState<SectionId>('lifecycle');
  const [selectedInsurerId, setSelectedInsurerId] = useState('');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [openSubprocessId, setOpenSubprocessId] = useState<string | null>(null);
  const [expandedProcesses, setExpandedProcesses] = useState<string[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    let alive = true;
    getCurrentUser().then((current) => { if (alive) setUser(current); })
      .catch((error: Error) => { if (alive) setToast(error.message); })
      .finally(() => { if (alive) setAuthLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user) { setAppLoading(false); return; }
    let alive = true;
    setAppLoading(true);
    loadWorkspace().then((snapshot) => {
      if (!alive) return;
      stateRef.current = snapshot.state; revisionRef.current = snapshot.revision;
      setWorkspace(snapshot.state); setAppLoading(false);
      setSelectedInsurerId(snapshot.state.insurers.find((item) => item.id === 'example-insurer')?.id ?? snapshot.state.insurers[0]?.id ?? '');
      setExpandedProcesses(snapshot.state.processes.filter((process) => !process.archived).slice(0, 2).map((process) => process.id));
    }).catch((error: Error) => { if (alive) { setSaveError(error.message); setSaveStatus('error'); setAppLoading(false); } });
    const unsubscribe = subscribeWorkspace((snapshot: WorkspaceSnapshot) => {
      if (!alive || snapshot.revision <= revisionRef.current) return;
      stateRef.current = snapshot.state; revisionRef.current = snapshot.revision;
      setWorkspace(snapshot.state); setSaveStatus('saved'); setSaveError('');
    });
    return () => { alive = false; unsubscribe(); };
  }, [user?.id]);

  const commit = useCallback<Commit>((update, meta) => {
    if (!user) return;
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const base = stateRef.current;
      if (!base) return;
      const next = pushHistory(update(base), meta, user);
      setSaveStatus('saving'); setSaveError('');
      try {
        const nextRevision = await saveWorkspace(next, revisionRef.current, user);
        revisionRef.current = nextRevision; stateRef.current = next; setWorkspace(next); setSaveStatus('saved');
      } catch (error) {
        setSaveStatus('error'); setSaveError(error instanceof Error ? error.message : 'The change could not be saved.');
        if (remoteEnabled) {
          try {
            const latest = await loadWorkspace(); revisionRef.current = latest.revision; stateRef.current = latest.state; setWorkspace(latest.state);
          } catch { /* Keep the visible save error for the researcher. */ }
        }
      }
    });
  }, [user]);

  const activeInsurers = workspace?.insurers ?? [];
  const selectedInsurer = activeInsurers.find((insurer) => insurer.id === selectedInsurerId) ?? activeInsurers[0];
  const sortedProcesses = useMemo(() => (workspace?.processes ?? []).filter((process) => !process.archived).sort((a, b) => a.order - b.order), [workspace?.processes]);
  const activeSubprocesses = useMemo(() => (workspace?.subprocesses ?? []).filter((subprocess) => !subprocess.archived && sortedProcesses.some((process) => process.id === subprocess.processId)), [workspace?.subprocesses, sortedProcesses]);

  const updateAssessment = (subprocessId: string, patch: Partial<Assessment>, summary: string) => {
    if (!workspace || !selectedInsurer || !user) return;
    const existing = assessmentFor(workspace, selectedInsurer.id, subprocessId);
    const id = existing?.id ?? newId();
    commit((state) => {
      const current = assessmentFor(state, selectedInsurer.id, subprocessId);
      const next: Assessment = { ...(current ?? emptyAssessment(selectedInsurer.id, subprocessId, user)), ...patch, updatedAt: new Date().toISOString(), owner: user.displayName };
      return { ...state, assessments: current ? state.assessments.map((item) => item.id === current.id ? next : item) : [...state.assessments, next] };
    }, { type: 'assessment', id, insurerId: selectedInsurer.id, summary });
  };

  const importWorkspace = async (file?: File) => {
    if (!file || !user) return;
    try {
      const parsed = JSON.parse(await file.text()) as WorkspaceState;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.insurers) || !Array.isArray(parsed.processes) || !Array.isArray(parsed.subprocesses)) throw new Error('The JSON file is not a Bench-Suite workspace export.');
      commit(() => parsed, { type: 'insurer', id: 'workspace', summary: 'Imported a workspace JSON backup' });
    } catch (error) { setToast(error instanceof Error ? error.message : 'The file could not be imported.'); }
  };

  const exportCsv = () => {
    if (!workspace || !selectedInsurer) return;
    const header = ['Reference', 'Process', 'Subprocess', 'Existence', 'Automation', 'Confidence', 'Technology', 'Vendor', 'Priority', 'Pain points', 'Notes'];
    const rows = activeSubprocesses.map((sub) => {
      const assessment = assessmentFor(workspace, selectedInsurer.id, sub.id);
      const points = workspace.painPoints.filter((point) => point.insurerId === selectedInsurer.id && point.subprocessId === sub.id);
      return [subprocessRef(sortedProcesses, activeSubprocesses, sub.id), nameById(sortedProcesses, sub.processId), sub.name,
        assessment?.existence ?? 'Not Assessed', assessment?.automation ?? 'Unknown', assessment?.confidence ?? 'Unverified',
        assessment?.technologyCategory ?? '', assessment?.vendor ?? '',
        priorityScore(assessment, points) ?? 'Unscored', points.length, assessment?.notes ?? ''];
    });
    downloadFile(`${selectedInsurer.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-ghi-benchmark.csv`, [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  };

  const doSignOut = async () => {
    await signOut(); setUser(null); setWorkspace(null); stateRef.current = null; setActivePage('lifecycle');
  };

  if (authLoading) return <Loading label="Checking your Bench-Suite workspace…" />;
  if (!user) return <Login onLogin={setUser} />;
  if (appLoading) return <Loading label="Loading the benchmark workspace…" />;
  if (!workspace) return <div className="fatal"><AlertCircle size={22} />{saveError || 'The workspace could not be opened.'}<button className="button" onClick={() => void doSignOut()}>Sign out</button></div>;

  const drawerSub = openSubprocessId ? workspace.subprocesses.find((item) => item.id === openSubprocessId && !item.archived) : undefined;
  const pageSearch = query.trim().toLowerCase();

  return <div className={`app-shell ${darkMode ? 'theme-dark' : ''}`}>
    <div className={`sidebar-wrap ${mobileNav ? 'shown' : ''}`}>
      <aside className="sidebar">
        <div className="brand-row"><div className="brand-mark"><Sparkles size={17} /></div><div><div className="brand-name">Bench-Suite</div><div className="brand-sub">GHI BENCHMARK</div></div><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={17} /></button></div>
        <div className="workspace-chip"><div className="workspace-avatar">B</div><div className="workspace-label"><strong>Example workspace</strong><span>Shared benchmark</span></div></div>
        <nav className="nav-list" aria-label="Main navigation">
          {(['Workspace'] as const).map((group) => <div className="nav-group" key={group}>
            <div className="nav-caption">{group}</div>
            {nav.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activePage === id ? 'selected' : ''}`} onClick={() => { setActivePage(id); setMobileNav(false); }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-card ${remoteEnabled ? 'sync-live' : ''}`}><span className="sync-dot" /><div><strong>{remoteEnabled ? 'Live collaboration' : 'Local preview'}</strong><span>{remoteEnabled ? 'Changes sync across users' : 'This browser only'}</span></div><CircleHelp size={15} /></div>
          <div className="profile-row"><div className="avatar">{user.displayName.slice(0, 1)}</div><div className="profile-name"><strong>{user.displayName}</strong><span>@{user.username}</span></div><button className="icon-button" title="Sign out" onClick={() => void doSignOut()}><LogOut size={16} /></button></div>
        </div>
      </aside>
      <button aria-label="Close menu" className="nav-scrim" onClick={() => setMobileNav(false)} />
    </div>

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{pageTitles[activePage]}</strong></div></div>
        <div className="topbar-tools">
          <label className="global-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this workspace" /><kbd>⌘ K</kbd></label>
          <span className="example-case-chip">Example case · {selectedInsurer?.name}</span>
          <button className="avatar avatar-small" title={user.displayName}>{user.displayName.slice(0, 1)}</button>
        </div>
      </header>
      <div className="page-scroll">
        <div className="page-container">
          <div className="page-heading">
            <div><div className="eyebrow">BENCH-SUITE <span>/</span> EXAMPLE WORKSPACE</div><h1>{pageTitles[activePage]}</h1><p className="page-description">{descriptionFor(activePage)}</p></div>
            <div className="heading-actions">
              <div className={`save-indicator ${saveStatus}`} aria-live="polite">{saveStatus === 'saving' ? <LoaderCircle size={14} className="spin" /> : saveStatus === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}<span>{saveStatus === 'saving' ? 'Saving' : saveStatus === 'error' ? 'Save issue' : 'All changes saved'}</span></div>
              {activePage === 'lifecycle' && <button className="button button-primary" onClick={() => setDialog({ kind: 'process' })}><Plus size={16} /> Add process</button>}
              {activePage === 'graph' && <button className="button button-primary" onClick={() => setDialog({ kind: 'connection' })}><GitBranchPlus size={15} /> Add connection</button>}
            </div>
          </div>
          {saveStatus === 'error' && saveError && <div className="alert-banner"><AlertCircle size={16} /><span>{saveError}</span><button onClick={() => setSaveError('')} aria-label="Dismiss"><X size={15} /></button></div>}
          {toast && <div className="toast-banner"><Check size={16} /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss"><X size={15} /></button></div>}

          {activePage === 'lifecycle' && selectedInsurer && <Lifecycle state={workspace} insurer={selectedInsurer} processes={sortedProcesses} subprocesses={activeSubprocesses} expanded={expandedProcesses} setExpanded={setExpandedProcesses} search={pageSearch} onAddSubprocess={(processId) => setDialog({ kind: 'subprocess', processId })} onEditProcess={(process) => setDialog({ kind: 'process', process })} onEditSubprocess={(processId, subprocess) => setDialog({ kind: 'subprocess', processId, subprocess })} onOpenSubprocess={setOpenSubprocessId} onAssessment={updateAssessment} onCommit={commit} />}
          {activePage === 'pain-points' && selectedInsurer && <PainPointExplorer state={workspace} insurer={selectedInsurer} query={pageSearch} onEdit={(pain) => setDialog({ kind: 'pain', subprocessId: pain.subprocessId, pain })} onOpenSubprocess={setOpenSubprocessId} />}
          {activePage === 'graph' && selectedInsurer && <GraphView state={workspace} insurerId={selectedInsurer.id} processes={sortedProcesses} subprocesses={activeSubprocesses} onConnect={(connection) => commit((state) => ({ ...state, connections: [...state.connections, connection] }), { type: 'connection', id: connection.id, insurerId: selectedInsurer.id, summary: 'Connected two workflow subprocesses' })} onOpenSubprocess={setOpenSubprocessId} />}
          {activePage === 'comparison' && <Comparison state={workspace} processes={sortedProcesses} subprocesses={activeSubprocesses} />}
          {activePage === 'opportunities' && <OpportunityAnalytics state={workspace} processes={sortedProcesses} subprocesses={activeSubprocesses} selectedInsurerId={selectedInsurer?.id ?? ''} onOpenSubprocess={setOpenSubprocessId} />}
          {activePage === 'evidence' && <EvidenceLibrary state={workspace} query={pageSearch} onOpenSubprocess={setOpenSubprocessId} onDelete={(evidence) => commit((state) => ({ ...state, evidence: state.evidence.filter((item) => item.id !== evidence.id) }), { type: 'evidence', id: evidence.id, insurerId: evidence.insurerId, summary: `Removed evidence: ${evidence.title}` })} />}
          {activePage === 'settings' && <SettingsPage state={workspace} user={user} darkMode={darkMode} setDarkMode={setDarkMode} onExportCsv={exportCsv} onImport={importWorkspace} onCommit={commit} />}
        </div>
        <footer className="page-footer"><span>Bench-Suite · GHI benchmark</span><span><span className="footer-dot" /> {sourceLabel()}</span><span>{sortedProcesses.length} processes · {activeSubprocesses.length} steps</span></footer>
      </div>
    </main>

    {drawerSub && selectedInsurer && <DetailDrawer key={`${selectedInsurer.id}-${drawerSub.id}`} subprocess={drawerSub} state={workspace} insurer={selectedInsurer} processes={sortedProcesses} allSubprocesses={activeSubprocesses} user={user} onClose={() => setOpenSubprocessId(null)} onAssessment={updateAssessment} onAddPain={() => setDialog({ kind: 'pain', subprocessId: drawerSub.id })} onEditPain={(pain) => setDialog({ kind: 'pain', subprocessId: drawerSub.id, pain })} onAddConnection={() => setDialog({ kind: 'connection', sourceId: drawerSub.id })} onEditConnection={(connection) => setDialog({ kind: 'connection', connection })} onDeleteConnection={(connection) => commit((state) => ({ ...state, connections: state.connections.filter((item) => item.id !== connection.id) }), { type: 'connection', id: connection.id, insurerId: selectedInsurer.id, summary: `Removed connection ${connection.label}` })} />}
    {dialog && <DialogLayer dialog={dialog} state={workspace} selectedInsurer={selectedInsurer} user={user} onClose={() => setDialog(null)} onCommit={commit} onToast={setToast} />}
  </div>;
}

function descriptionFor(section: SectionId) {
  const text: Record<SectionId, string> = {
    overview: 'A focused GHI process benchmark.', insurers: 'A focused GHI process benchmark.',
    lifecycle: 'Edit the example GHI process benchmark, add or remove steps, and record simple notes.', 'pain-points': 'Simple notes attached to benchmark steps.',
    graph: 'Map and edit directed links between benchmark steps.', comparison: 'A focused GHI process benchmark.',
    opportunities: 'Prioritise evidence-backed gaps; unknown assessments remain unscored.', evidence: 'Keep source material connected to the processes it supports.',
    settings: 'Manage collaboration, storage and workspace data.',
  };
  return text[section];
}

function Loading({ label }: { label: string }) {
  return <div className="loading-screen"><div className="brand-mark large"><Sparkles size={20} /></div><LoaderCircle className="spin" size={18} /><span>{label}</span></div>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { onLogin(await signIn(username, password)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  return <div className="login-page">
    <div className="login-grid" />
    <div className="login-card">
      <div className="login-brand"><div className="brand-mark"><Sparkles size={18} /></div><div><div className="brand-name">Bench-Suite</div><div className="brand-sub">GHI BENCHMARK</div></div></div>
      <div className="login-kicker">BENCH-SUITE WORKSPACE</div><h1>Welcome back</h1><p>Sign in to edit the example GHI benchmark and its workflow graph.</p>
      <form onSubmit={(event) => void submit(event)} className="login-form">
        <label className="field-label" htmlFor="username">Username</label><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your username" required />
        <div className="password-label"><label className="field-label" htmlFor="password">Password</label><button type="button" className="text-button" onClick={() => setPassword('1234')}>Use shared demo password</button></div>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
        {error && <div className="login-error"><AlertCircle size={15} />{error}</div>}
        <button type="submit" className="button button-primary login-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}{busy ? 'Signing in…' : 'Sign in to workspace'}</button>
      </form>
      <div className="login-divider"><span>TEAM ACCESS</span></div>
      <div className="team-access">{['pankaj', 'sakshi', 'dheeraj', 'vaibhav'].map((name) => <button key={name} onClick={() => { setUsername(name); setPassword('1234'); }}><span className="avatar avatar-tiny">{name[0]?.toUpperCase()}</span><span>{name}</span></button>)}</div>
      <div className="login-foot"><Database size={14} /><span>{remoteEnabled ? 'Connected to shared research storage' : 'Local preview · saved in this browser only'}</span></div>
    </div>
    <div className="login-side-note"><div className="login-orb" /><div className="side-note-content"><span>EXAMPLE-INSURER</span><h2>Benchmark the work.<br />Map the flow.</h2><p>A focused GHI process editor with an editable workflow graph and simple notes on each step.</p><div className="side-note-stats"><div><strong>1</strong><span>Example case</span></div><div><strong>7</strong><span>Processes</span></div><div><strong>65</strong><span>Subprocesses</span></div></div></div></div>
  </div>;
}

function StatCard({ label, value, icon: Icon, hint, accent = 'purple' }: { label: string; value: string | number; icon: typeof Activity; hint: string; accent?: string }) {
  return <div className="stat-card"><div className={`stat-icon ${accent}`}><Icon size={18} /></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

function StatusBadge({ value, kind }: { value: string; kind?: 'confidence' | 'severity' }) {
  const label = value === 'Doesn\'t Exist' ? 'Doesn’t exist' : value;
  const color = kind === 'confidence' ? ({ High: 'green', Medium: 'blue', Low: 'amber', Unverified: 'gray' }[value] ?? 'gray') : kind === 'severity' ? ({ Critical: 'red', High: 'red', Medium: 'amber', Low: 'green' }[value] ?? 'gray') : classForStatus(value);
  return <span className={`status-badge ${color}`}><i />{label}</span>;
}

function Lifecycle({ state, insurer, processes, subprocesses, expanded, setExpanded, search, onAddSubprocess, onEditProcess, onEditSubprocess, onOpenSubprocess, onAssessment, onCommit }: {
  state: WorkspaceState; insurer: Insurer; processes: Process[]; subprocesses: Subprocess[]; expanded: string[]; setExpanded: (ids: string[]) => void; search: string;
  onAddSubprocess: (processId: string) => void; onEditProcess: (process: Process) => void;
  onEditSubprocess: (processId: string, subprocess: Subprocess) => void; onOpenSubprocess: (id: string) => void;
  onAssessment: (id: string, patch: Partial<Assessment>, summary: string) => void; onCommit: Commit;
}) {
  const [filter, setFilter] = useState('All status');
  const filteredProcesses = processes.map((process) => ({ ...process, children: subprocesses.filter((sub) => sub.processId === process.id).filter((sub) => sub.name.toLowerCase().includes(search)) })).filter((process) => (search ? process.name.toLowerCase().includes(search) || process.children.length > 0 : true));
  const active = subprocesses.length;
  const assessed = state.assessments.filter((item) => item.insurerId === insurer.id && item.existence !== 'Not Assessed').length;
  const statusOptions = ['All status', 'Exists', 'Partially Exists', "Doesn't Exist", 'Not Assessed'];
  const toggle = (id: string) => setExpanded(expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id]);
  return <>
    <div className="benchmark-summary"><div className="benchmark-summary-title"><div className="insurer-big-mark">EX</div><div><span>EXAMPLE CASE</span><h2>{insurer.name}</h2><p>Illustrative GHI benchmark · no real company data</p></div></div><div className="benchmark-summary-stats"><div><strong>{processes.length}</strong><span>Processes</span></div><div><strong>{active}</strong><span>Subprocesses</span></div><div><strong>{assessed}<small>/{active}</small></strong><span>Assessed</span></div><button className="button button-quiet" onClick={() => setExpanded(expanded.length === processes.length ? [] : processes.map((item) => item.id))}>{expanded.length === processes.length ? 'Collapse all' : 'Expand all'}</button></div></div>
    <div className="toolbar-card lifecycle-toolbar"><div className="toolbar-copy"><Layers3 size={16} /><strong>{Math.round(assessed / Math.max(active, 1) * 100)}% assessed</strong><span>Example benchmark progress</span></div><div className="toolbar-filters"><label className="filter-control"><ListFilter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)}>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label></div></div>
    <div className="process-list">{filteredProcesses.map((process, pIndex) => {
      const isOpen = expanded.includes(process.id);
      const children = process.children.filter((sub) => {
        const status = assessmentFor(state, insurer.id, sub.id)?.existence ?? 'Not Assessed';
        return (filter === 'All status' || status === filter) && (!search || process.name.toLowerCase().includes(search) || sub.name.toLowerCase().includes(search));
      });
      const allChildren = subprocesses.filter((sub) => sub.processId === process.id);
      const assessedCount = allChildren.filter((sub) => (assessmentFor(state, insurer.id, sub.id)?.existence ?? 'Not Assessed') !== 'Not Assessed').length;
      return <section className={`process-card ${isOpen ? 'expanded' : ''}`} key={process.id}>
        <div className="process-heading" role="button" tabIndex={0} onClick={() => toggle(process.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(process.id); } }} aria-expanded={isOpen}><span className="process-number">{String(pIndex + 1).padStart(2, '0')}</span><span className="process-title"><strong>{process.name}</strong><small>{process.description || 'Describe the work covered by this process.'}</small></span><span className="process-progress"><span className="mini-progress"><i style={{ width: `${Math.round(assessedCount / Math.max(allChildren.length, 1) * 100)}%` }} /></span><small>{assessedCount}/{allChildren.length} assessed</small></span><span className="process-child-count">{allChildren.length} steps</span><button type="button" className="icon-button process-more" aria-label={`Edit ${process.name}`} onClick={(event) => { event.stopPropagation(); onEditProcess(process); }}><MoreHorizontal size={17} /></button><ChevronDown size={17} className={`process-chevron ${isOpen ? 'rotate' : ''}`} /></div>
        {isOpen && <div className="subprocess-table"><div className="subprocess-head"><span>REF</span><span>SUBPROCESS</span><span>STATUS</span><span>AUTOMATION</span><span>NOTES / LINKS</span><span /></div>{children.map((sub) => {
          const assessment = assessmentFor(state, insurer.id, sub.id);
          const points = state.painPoints.filter((point) => point.insurerId === insurer.id && point.subprocessId === sub.id);
          const ref = subprocessRef(processes, subprocesses, sub.id);
          return <div className="subprocess-row" key={sub.id}>
            <span className="sub-ref">{ref}</span><button className="sub-name-button" onClick={() => onOpenSubprocess(sub.id)}><strong>{sub.name}</strong><span>{sub.description || 'Open benchmark details'}</span></button>
            <select className={`inline-select ${classForStatus(assessment?.existence ?? 'Not Assessed')}`} aria-label={`${sub.name} status`} value={assessment?.existence ?? 'Not Assessed'} onClick={(event) => event.stopPropagation()} onChange={(event) => onAssessment(sub.id, { existence: event.target.value as Assessment['existence'] }, `Changed ${ref} status to ${event.target.value}`)}>{EXISTENCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select>
            <select className="inline-select automation-select" aria-label={`${sub.name} automation`} value={assessment?.automation ?? 'Unknown'} onChange={(event) => onAssessment(sub.id, { automation: event.target.value as Assessment['automation'] }, `Changed ${ref} automation to ${event.target.value}`)}>{AUTOMATION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select>
            <button className="detail-counts" onClick={() => onOpenSubprocess(sub.id)} aria-label={`${points.length} pain notes and ${state.connections.filter((item) => item.insurerId === insurer.id && (item.sourceId === sub.id || item.targetId === sub.id)).length} workflow links`}><span><FileText size={13} />{points.length}</span><span><GitBranch size={13} />{state.connections.filter((item) => item.insurerId === insurer.id && (item.sourceId === sub.id || item.targetId === sub.id)).length}</span></button>
            <button className="icon-button row-edit" aria-label={`Edit ${sub.name}`} onClick={() => onEditSubprocess(process.id, sub)}><MoreHorizontal size={16} /></button>
          </div>;
        })}{children.length === 0 && <div className="no-subprocesses">No subprocesses match this filter.</div>}<button className="add-subprocess" onClick={() => onAddSubprocess(process.id)}><Plus size={14} /> Add subprocess to {process.name}</button><button className="archive-process" onClick={() => onCommit((prev) => ({ ...prev, processes: prev.processes.map((item) => item.id === process.id ? { ...item, archived: true } : item), subprocesses: prev.subprocesses.map((sub) => sub.processId === process.id ? { ...sub, archived: true } : sub) }), { type: 'process', id: process.id, summary: `Archived process: ${process.name}` })}><Trash2 size={13} /> Remove process</button></div>}
      </section>;
    })}</div>
    <div className="inline-note"><CircleHelp size={15} /><span>Removing a stage archives it and its subprocesses. Existing assessments and connections remain stored by UUID so research references are preserved.</span></div>
  </>;
}

function PainPointExplorer({ state, insurer, query, onEdit, onOpenSubprocess }: { state: WorkspaceState; insurer: Insurer; query: string; onEdit: (pain: PainPoint) => void; onOpenSubprocess: (id: string) => void }) {
  const [severity, setSeverity] = useState('All severity');
  const [validation, setValidation] = useState('All validation');
  const pains = state.painPoints.filter((pain) => (pain.insurerId === insurer.id || !insurer) && `${pain.title} ${pain.description} ${nameById(state.subprocesses, pain.subprocessId)}`.toLowerCase().includes(query) && (severity === 'All severity' || pain.severity === severity) && (validation === 'All validation' || pain.validation === validation));
  return <>
    <div className="toolbar-card"><div className="toolbar-copy"><AlertCircle size={16} /><strong>{pains.length} pain points</strong><span>Research items remain labelled by confidence and validation.</span></div><div className="toolbar-filters"><label className="filter-control"><SlidersHorizontal size={14} /><select value={severity} onChange={(event) => setSeverity(event.target.value)}>{['All severity', ...SEVERITY_OPTIONS].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label><label className="filter-control"><ListFilter size={14} /><select value={validation} onChange={(event) => setValidation(event.target.value)}>{['All validation', ...VALIDATION_OPTIONS].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label></div></div>
    {pains.length ? <div className="table-panel"><div className="table-wrap"><table><thead><tr><th>PAIN POINT</th><th>PROCESS / SUBPROCESS</th><th>SEVERITY</th><th>CONFIDENCE</th><th>VALIDATION</th><th>PRIORITY</th><th /></tr></thead><tbody>{pains.map((pain) => {
      const sub = state.subprocesses.find((item) => item.id === pain.subprocessId);
      const assessment = assessmentFor(state, insurer.id, pain.subprocessId);
      const score = priorityScore(assessment, [pain]);
      return <tr key={pain.id}><td><button className="pain-title" onClick={() => onEdit(pain)}><strong>{pain.title}</strong><span>{pain.description || 'Add a description to capture the scenario.'}</span></button></td><td><button className="reference-link" onClick={() => onOpenSubprocess(pain.subprocessId)}>{sub ? subprocessRef(state.processes, state.subprocesses, sub.id) : '—'} <span>{sub?.name ?? 'Archived subprocess'}</span></button></td><td><StatusBadge value={pain.severity} kind="severity" /></td><td><StatusBadge value={pain.confidence} kind="confidence" /></td><td><StatusBadge value={pain.validation} /></td><td>{score === null ? <span className="unscored">Unscored</span> : <strong>{score}/100</strong>}</td><td><button className="icon-button" onClick={() => onEdit(pain)} title="Edit pain point"><MoreHorizontal size={16} /></button></td></tr>;
    })}</tbody></table></div><div className="table-footer"><span>Showing {pains.length} research items</span><span>Hypotheses are not treated as confirmed problems.</span></div></div> : <div className="panel empty-page"><EmptyState icon={AlertCircle} title="No pain points logged" text="Add a research observation to a subprocess. Hypotheses stay separate from confirmed issues." /></div>}
  </>;
}

type BenchmarkNodeData = { label: string; reference: string; existence: string; onSelect: () => void };
type BenchmarkFlowNode = Node<BenchmarkNodeData, 'benchmark'>;

function BenchmarkNode({ data, selected }: NodeProps<BenchmarkFlowNode>) {
  return <div className={`flow-node ${classForStatus(data.existence)} ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="flow-node-top"><span>{data.reference}</span><span className={`flow-state-dot ${classForStatus(data.existence)}`} /></div>
    <strong>{data.label}</strong><small>{data.existence}</small>
    <Handle type="source" position={Position.Right} />
  </div>;
}

const nodeTypes: NodeTypes = { benchmark: BenchmarkNode };

function GraphView({ state, insurerId, processes, subprocesses, onConnect, onOpenSubprocess }: {
  state: WorkspaceState; insurerId: string; processes: Process[]; subprocesses: Subprocess[];
  onConnect: (connection: WorkflowConnection) => void; onOpenSubprocess: (id: string) => void;
}) {
  const [focus, setFocus] = useState('All processes');
  const links = state.connections.filter((connection) => connection.insurerId === insurerId);
  const visibleProcesses = focus === 'All processes' ? processes : processes.filter((process) => process.id === focus);
  const nodes: BenchmarkFlowNode[] = visibleProcesses.flatMap((process, processIndex) => subprocesses.filter((sub) => sub.processId === process.id).map((sub, row) => {
    const assessment = assessmentFor(state, insurerId, sub.id);
    return { id: sub.id, type: 'benchmark', position: { x: processIndex * 310 + 40, y: row * 116 + 55 }, data: { label: sub.name, reference: subprocessRef(processes, subprocesses, sub.id), existence: assessment?.existence ?? 'Not Assessed', onSelect: () => onOpenSubprocess(sub.id) } };
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: Edge[] = links.filter((link) => nodeById.has(link.sourceId) && nodeById.has(link.targetId)).map((link) => ({
    id: link.id, source: link.sourceId, target: link.targetId, label: link.label || `${subprocessRef(processes, subprocesses, link.sourceId)} → ${subprocessRef(processes, subprocesses, link.targetId)}`,
    animated: link.reliability === 'Partially Reliable', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: link.reliability === 'Unreliable' ? '#db7777' : link.reliability === 'Reliable' ? '#43a581' : '#9b8cf2', strokeWidth: 1.8 }, labelStyle: { fill: '#63627a', fontSize: 11 }, labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
  }));
  const createConnection = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target || links.some((item) => item.sourceId === connection.source && item.targetId === connection.target)) return;
    const sourceRef = subprocessRef(processes, subprocesses, connection.source);
    const targetRef = subprocessRef(processes, subprocesses, connection.target);
    onConnect({ id: newId(), insurerId, sourceId: connection.source, targetId: connection.target, label: `${sourceRef} → ${targetRef}`, type: 'System integration', reliability: 'Unknown', notes: '' });
  };
  return <>
    <div className="graph-toolbar"><div className="graph-legend"><span><i className="legend-dot status-0" /> Exists</span><span><i className="legend-dot status-1" /> Partial</span><span><i className="legend-dot status-2" /> Doesn’t exist</span><span><i className="legend-dot status-3" /> Not assessed</span></div><label className="filter-control"><Filter size={14} /><select value={focus} onChange={(event) => setFocus(event.target.value)}><option>All processes</option>{processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}</select><ChevronDown size={13} /></label></div>
    <div className="graph-canvas"><ReactFlow<BenchmarkFlowNode, Edge> key={focus} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onConnect={createConnection} onNodeClick={(_, node) => onOpenSubprocess(node.id)} fitView fitViewOptions={{ padding: 0.12, minZoom: 0.5, maxZoom: 0.9 }} minZoom={0.12} maxZoom={1.5} nodesConnectable nodesDraggable proOptions={{ hideAttribution: true }}><Background color="#e9eaf0" gap={24} size={1} /><Controls position="bottom-right" /><MiniMap position="bottom-left" pannable zoomable nodeColor={(node) => { const status = (node.data as BenchmarkNodeData).existence; return status === 'Exists' ? '#48ad8a' : status === 'Partially Exists' ? '#e5b051' : status === "Doesn't Exist" ? '#e17878' : '#d4d6de'; }} /></ReactFlow></div>
    <div className="graph-caption"><span><GitBranch size={14} /> {edges.length} workflow links</span><span>Drag between node handles to add a link. Select a node to edit its benchmark details.</span></div>
  </>;
}

function Comparison({ state, processes, subprocesses }: { state: WorkspaceState; processes: Process[]; subprocesses: Subprocess[] }) {
  const [search, setSearch] = useState('');
  const insurers = state.insurers.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  const processCoverage = processes.map((process) => {
    const ids = subprocesses.filter((sub) => sub.processId === process.id).map((sub) => sub.id);
    return { process, ids };
  });
  return <>
    <div className="comparison-intro"><div className="comparison-icon"><GitBranch size={18} /></div><div><strong>Compare lifecycle assessment coverage</strong><span>Coverage counts researched subprocesses. It does not rate insurer performance.</span></div><label className="search-input"><Search size={15} /><input placeholder="Find company" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <div className="matrix-panel"><div className="matrix-scroll"><table className="comparison-table"><thead><tr><th className="sticky-company">COMPANY</th>{processCoverage.map(({ process }, index) => <th key={process.id}><span className="matrix-step">{index + 1}</span>{process.name}</th>)}<th>OVERALL</th></tr></thead><tbody>{insurers.map((insurer) => {
      const allIds = subprocesses.map((sub) => sub.id);
      const measured = allIds.filter((id) => (assessmentFor(state, insurer.id, id)?.existence ?? 'Not Assessed') !== 'Not Assessed').length;
      const overall = Math.round(measured / Math.max(allIds.length, 1) * 100);
      return <tr key={insurer.id}><th className="sticky-company"><span className="matrix-logo">{insurer.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span>{insurer.name}</span></th>{processCoverage.map(({ process, ids }) => {
        const completed = ids.filter((id) => (assessmentFor(state, insurer.id, id)?.existence ?? 'Not Assessed') !== 'Not Assessed').length;
        const pct = Math.round(completed / Math.max(ids.length, 1) * 100);
        return <td key={process.id}><span className={`matrix-coverage ${pct > 66 ? 'strong' : pct > 0 ? 'partial' : ''}`}><i style={{ height: `${Math.max(3, pct)}%` }} />{pct}%</span></td>;
      })}<td><div className="overall-cell"><strong>{overall}%</strong><span className="mini-progress"><i style={{ width: `${overall}%` }} /></span></div></td></tr>;
    })}</tbody></table></div><div className="table-footer"><span>{insurers.length} companies</span><span>Blank or 0% means no assessments have been saved for that stage.</span></div></div>
  </>;
}

function OpportunityAnalytics({ state, processes, subprocesses, selectedInsurerId, onOpenSubprocess }: { state: WorkspaceState; processes: Process[]; subprocesses: Subprocess[]; selectedInsurerId: string; onOpenSubprocess: (id: string) => void }) {
  const insurerIds = selectedInsurerId ? [selectedInsurerId] : state.insurers.map((item) => item.id);
  const records = insurerIds.flatMap((insurerId) => subprocesses.map((sub) => {
    const assessment = assessmentFor(state, insurerId, sub.id);
    const points = state.painPoints.filter((item) => item.insurerId === insurerId && item.subprocessId === sub.id);
    return { insurerId, sub, score: priorityScore(assessment, points), points, assessment };
  })).filter((item) => item.score !== null).sort((a, b) => b.score! - a.score!);
  const unknown = insurerIds.reduce((count, insurerId) => count + subprocesses.filter((sub) => (assessmentFor(state, insurerId, sub.id)?.existence ?? 'Not Assessed') === 'Not Assessed').length, 0);
  const connectionCount = state.connections.filter((item) => insurerIds.includes(item.insurerId)).length;
  const manual = records.filter((item) => item.assessment?.automation === 'Manual' || item.assessment?.automation === 'Partially Automated').length;
  const stageScores = processes.map((process) => {
    const stage = records.filter((item) => item.sub.processId === process.id);
    return { process, count: stage.length, score: stage.length ? Math.round(stage.reduce((total, item) => total + item.score!, 0) / stage.length) : null };
  });
  return <>
    <div className="stat-grid analytics-stats"><StatCard label="Evidence-backed opportunities" value={records.length} icon={Target} hint="Scored from supported research" accent="purple" /><StatCard label="Manual / partial steps" value={manual} icon={SlidersHorizontal} hint="Among evidence-backed records" accent="amber" /><StatCard label="Directed dependencies" value={connectionCount} icon={GitBranch} hint="Workflow links recorded" accent="blue" /><StatCard label="Awaiting assessment" value={unknown.toLocaleString()} icon={CircleHelp} hint="Unknown is not treated as zero priority" accent="green" /></div>
    <div className="analytics-grid"><section className="panel stage-analytics"><div className="panel-heading"><div><div className="section-label">PRIORITY BY LIFECYCLE STAGE</div><h2>Evidence-backed opportunity score</h2><p>Average score only across subprocesses with an evidence-supported or confirmed pain point.</p></div><BarChart3 size={18} className="muted-icon" /></div><div className="stage-bars">{stageScores.map(({ process, count, score }, index) => <div className="stage-bar-row" key={process.id}><span className="stage-bar-num">{String(index + 1).padStart(2, '0')}</span><span className="stage-bar-name">{process.name}</span><div className="stage-bar-track"><i style={{ width: `${score ?? 0}%` }} className={score === null ? 'empty' : ''} /></div><strong>{score === null ? '—' : score}</strong><small>{count} scored</small></div>)}</div></section><section className="panel scoring-panel"><div className="panel-heading"><div><div className="section-label">SCORING MODEL</div><h2>How priorities are ranked</h2></div></div><div className="score-formula"><div><span>01</span><strong>Assess existence</strong><small>Partial and missing status inform the opportunity gap.</small></div><div><span>02</span><strong>Support a pain point</strong><small>Only Evidence Supported and Confirmed items qualify.</small></div><div><span>03</span><strong>Weigh impact factors</strong><small>Severity, business impact, frequency, manual effort and confidence.</small></div></div><div className="unknown-note"><CircleHelp size={15} /><span>{unknown.toLocaleString()} unassessed records stay unknown; they are not assigned a zero score.</span></div></section></div>
    <section className="panel opportunity-table"><div className="panel-heading"><div><div className="section-label">RANKED RESEARCH</div><h2>Prioritised subprocesses</h2></div><span className="small-pill">{records.length} scored</span></div>{records.length ? <div className="table-wrap"><table><thead><tr><th>SCORE</th><th>SUBPROCESS</th><th>INSURER</th><th>EXISTENCE</th><th>TOP VALIDATED PAIN POINT</th><th>CONFIDENCE</th></tr></thead><tbody>{records.slice(0, 80).map((item) => <tr key={`${item.insurerId}-${item.sub.id}`} onClick={() => onOpenSubprocess(item.sub.id)}><td><span className={`priority-pill ${item.score! >= 70 ? 'high' : item.score! >= 45 ? 'medium' : 'low'}`}><i />{item.score}</span></td><td><button className="reference-link">{subprocessRef(processes, subprocesses, item.sub.id)} <span>{item.sub.name}</span></button></td><td>{nameById(state.insurers, item.insurerId)}</td><td><StatusBadge value={item.assessment?.existence ?? 'Not Assessed'} /></td><td>{item.points.find((point) => point.validation === 'Confirmed' || point.validation === 'Evidence Supported')?.title}</td><td><StatusBadge value={item.points[0]?.confidence ?? 'Unverified'} kind="confidence" /></td></tr>)}</tbody></table></div> : <EmptyState icon={Target} title="Nothing to rank yet" text="No insurer findings are seeded. Add a real assessment and evidence-supported pain point to populate this list." />}</section>
  </>;
}

function EvidenceLibrary({ state, query, onOpenSubprocess, onDelete }: { state: WorkspaceState; query: string; onOpenSubprocess: (id: string) => void; onDelete: (item: EvidenceItem) => void }) {
  const [type, setType] = useState('All types');
  const records = state.evidence.filter((item) => `${item.title} ${item.excerpt} ${nameById(state.insurers, item.insurerId)}`.toLowerCase().includes(query) && (type === 'All types' || item.sourceType === type));
  return <>
    <div className="toolbar-card"><div className="toolbar-copy"><BookOpenText size={16} /><strong>{state.evidence.length} sources</strong><span>Evidence can be attached to a subprocess or insurer.</span></div><div className="toolbar-filters"><label className="filter-control"><Filter size={14} /><select value={type} onChange={(event) => setType(event.target.value)}>{['All types', 'Insurer website', 'Policy document', 'Regulatory filing', 'Interview', 'Product demo', 'Other'].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label></div></div>
    {records.length ? <div className="evidence-grid">{records.map((item) => <article className="evidence-card" key={item.id}><div className="evidence-card-top"><div className="evidence-icon"><FileText size={17} /></div><button className="icon-button" title="Remove evidence" onClick={() => onDelete(item)}><Trash2 size={15} /></button></div><div className="section-label">{item.sourceType}</div><h3>{item.title}</h3><p>{item.excerpt || 'No excerpt provided.'}</p><div className="evidence-meta"><span>{nameById(state.insurers, item.insurerId)}</span><span>·</span><span>{formatDate(item.capturedAt)}</span></div><div className="evidence-card-bottom"><StatusBadge value={item.confidence} kind="confidence" />{item.subprocessId ? <button className="text-button" onClick={() => onOpenSubprocess(item.subprocessId!)}>{subprocessRef(state.processes, state.subprocesses, item.subprocessId)} <ArrowUpRight size={13} /></button> : <span className="unscored">Insurer-wide</span>}</div>{item.url && <a className="evidence-url" href={item.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={13} /></a>}</article>)}</div> : <div className="panel empty-page"><EmptyState icon={BookOpenText} title="No evidence in the library" text="Add a source URL, quote or reference and link it to a subprocess when useful." /></div>}
  </>;
}

function SettingsPage({ state, user, darkMode, setDarkMode, onExportCsv, onImport, onCommit }: {
  state: WorkspaceState; user: User; darkMode: boolean; setDarkMode: (value: boolean) => void; onExportCsv: () => void;
  onImport: (file?: File) => Promise<void>; onCommit: Commit;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const activeProcesses = state.processes.filter((process) => !process.archived).length;
  const subCount = state.subprocesses.filter((sub) => !sub.archived).length;
  const clearResearch = () => {
    if (!window.confirm('Reset assessments, pain points, connections, evidence and history for this shared workspace? Insurers and lifecycle sections will stay in place.')) return;
    onCommit((prev) => ({ ...prev, assessments: [], painPoints: [], connections: [], evidence: [], history: [] }), { type: 'insurer', id: 'workspace', summary: 'Reset benchmark research data' });
  };
  return <div className="settings-layout">
    <div className="settings-main">
      <section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon"><Database size={17} /></div><div><h2>Data and collaboration</h2><p>Storage, shared access and local cache.</p></div></div><div className={`storage-card ${remoteEnabled ? 'connected' : ''}`}><div className="storage-status-icon">{remoteEnabled ? <Check size={18} /> : <Database size={18} />}</div><div className="storage-copy"><strong>{sourceLabel()}</strong><p>{remoteEnabled ? 'Updates publish to the shared database and appear live for other signed-in team members.' : 'This preview uses IndexedDB in this browser. To share edits across people and devices, configure Supabase and redeploy.'}</p></div><span className={`status-badge ${remoteEnabled ? 'green' : 'amber'}`}><i />{remoteEnabled ? 'Connected' : 'Preview'}</span></div><div className="settings-key-values"><div><span>Signed-in user</span><strong>{user.displayName} <small>@{user.username}</small></strong></div><div><span>Active processes</span><strong>{activeProcesses}</strong></div><div><span>Active subprocesses</span><strong>{subCount}</strong></div><div><span>Workspace users</span><strong>4 invited accounts</strong></div></div></section>
      <section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon"><Download size={17} /></div><div><h2>Backup and export</h2><p>Download a copy or export one insurer’s assessment rows.</p></div></div><div className="setting-row"><div><strong>Workspace backup</strong><span>Includes insurers, lifecycle structure and research records as JSON.</span></div><button className="button button-quiet" onClick={() => downloadFile('Bench-Suite-ghi-workspace.json', JSON.stringify(state, null, 2), 'application/json')}><Download size={15} /> Export JSON</button></div><div className="setting-row"><div><strong>Selected insurer CSV</strong><span>Structured assessment and subprocess reference columns.</span></div><button className="button button-quiet" onClick={onExportCsv}><Download size={15} /> Export CSV</button></div><div className="setting-row"><div><strong>Restore workspace backup</strong><span>Import a JSON backup that follows schema version 1.</span></div><button className="button button-quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /> Choose file</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { void onImport(event.target.files?.[0]); event.currentTarget.value = ''; }} /></div></section>
      <section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon"><SlidersHorizontal size={17} /></div><div><h2>Appearance</h2><p>Choose a comfortable canvas for your research.</p></div></div><div className="setting-row"><div><strong>Dark theme</strong><span>Apply a darker workspace canvas in this browser.</span></div><button role="switch" aria-checked={darkMode} className={`switch ${darkMode ? 'on' : ''}`} onClick={() => setDarkMode(!darkMode)}><i /></button></div></section>
      <section className="panel settings-panel danger-panel"><div className="settings-section-heading"><div className="settings-icon danger"><Trash2 size={17} /></div><div><h2>Research reset</h2><p>Remove saved benchmark observations for a clean start.</p></div></div><div className="setting-row"><div><strong>Clear research records</strong><span>Removes assessments, pain points, links, evidence and activity history.</span></div><button className="button button-danger" onClick={clearResearch}><Trash2 size={14} /> Reset research</button></div></section>
    </div>
    <aside className="settings-aside"><div className="panel help-card"><div className="help-icon"><ShieldCheck size={18} /></div><h3>Team access</h3><p>Supabase mode accepts only provisioned team accounts. Public signups should be disabled in Supabase Auth.</p><div className="user-chip-list">{['Pankaj', 'Sakshi', 'Dheeraj', 'Vaibhav'].map((name) => <div key={name}><span className="avatar avatar-tiny">{name[0]}</span><strong>{name}</strong><span>Researcher</span></div>)}</div><div className="help-foot"><CircleHelp size={14} /><span>All four requested usernames share the configured demo password.</span></div></div><div className="panel template-card"><div className="section-label">LIFECYCLE TEMPLATE</div><h3>Editable structure</h3><p>Process and subprocess identifiers are UUIDs. Display references are generated from the current order.</p><div className="template-count"><span><Layers3 size={15} />{activeProcesses} processes</span><span><Workflow size={15} />{subCount} subprocesses</span></div><div className="template-notice">Archived sections retain linked assessments and connections.</div></div></aside>
  </div>;
}

function EmptyState({ icon: Icon, title, text, action, onAction }: { icon: typeof Activity; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={18} /></div><strong>{title}</strong><p>{text}</p>{action && <button className="text-button" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>}</div>;
}

function DetailDrawer({ subprocess, state, insurer, processes, allSubprocesses, user, onClose, onAssessment, onAddPain, onEditPain, onAddConnection, onEditConnection, onDeleteConnection }: {
  subprocess: Subprocess; state: WorkspaceState; insurer: Insurer; processes: Process[]; allSubprocesses: Subprocess[]; user: User; onClose: () => void;
  onAssessment: (id: string, patch: Partial<Assessment>, summary: string) => void; onAddPain: () => void;
  onEditPain: (pain: PainPoint) => void; onAddConnection: () => void; onEditConnection: (connection: WorkflowConnection) => void; onDeleteConnection: (connection: WorkflowConnection) => void;
}) {
  const [tab, setTab] = useState('Assessment');
  const assessment = assessmentFor(state, insurer.id, subprocess.id);
  const points = state.painPoints.filter((point) => point.insurerId === insurer.id && point.subprocessId === subprocess.id);
  const connections = state.connections.filter((item) => item.insurerId === insurer.id && (item.sourceId === subprocess.id || item.targetId === subprocess.id));
  const ref = subprocessRef(processes, allSubprocesses, subprocess.id);
  const apply = (patch: Partial<Assessment>, label: string) => onAssessment(subprocess.id, patch, `${ref}: ${label}`);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${subprocess.name} benchmark details`}>
      <div className="drawer-topline"><div className="drawer-context">{nameById(processes, subprocess.processId)} <ChevronRight size={13} /> <strong>{ref}</strong></div><button className="icon-button" aria-label="Close detail drawer" onClick={onClose}><X size={17} /></button></div>
      <div className="drawer-title"><span className="reference-chip">{ref}</span><h2>{subprocess.name}</h2><p>{subprocess.description || 'Edit this example benchmark step, add a note, or connect it in the workflow graph.'}</p><div className="drawer-meta"><span className="drawer-insurer-mark">EX</span><strong>{insurer.name}</strong><span>·</span><span>Edited by {assessment?.owner || user.displayName}</span></div></div>
      <div className="drawer-tabs" role="tablist">{['Assessment', 'Pain notes', 'Connections'].map((item) => <button role="tab" aria-selected={tab === item} key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}{item === 'Pain notes' && points.length ? <span>{points.length}</span> : null}</button>)}</div>
      <div className="drawer-body">
        {tab === 'Assessment' && <><div className="drawer-section-heading"><span>BENCHMARK STATUS</span><p>Set the example capability status and automation level.</p></div><Field label="Status"><select value={assessment?.existence ?? 'Not Assessed'} onChange={(event) => apply({ existence: event.target.value as Assessment['existence'] }, `status set to ${event.target.value}`)}>{EXISTENCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Automation"><select value={assessment?.automation ?? 'Unknown'} onChange={(event) => apply({ automation: event.target.value as Assessment['automation'] }, `automation set to ${event.target.value}`)}>{AUTOMATION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Benchmark notes"><textarea key={`assessment-${subprocess.id}`} defaultValue={assessment?.notes ?? ''} placeholder="Add context for this benchmark step…" rows={5} onBlur={(event) => { if (event.target.value !== (assessment?.notes ?? '')) apply({ notes: event.target.value }, 'benchmark notes updated'); }} /></Field><div className="drawer-footnote"><Clock3 size={13} />Last edited {assessment?.updatedAt ? formatDate(assessment.updatedAt) : 'not yet edited'}</div></>}
        {tab === 'Pain notes' && <><div className="drawer-section-heading drawer-section-row"><div><span>PAIN POINT NOTES</span><p>Plain notes attached to this step.</p></div><button className="button button-quiet button-small" onClick={onAddPain}><Plus size={14} /> Add note</button></div>{points.length ? points.map((pain) => <article className="drawer-pain-card" key={pain.id}><div className="drawer-pain-title"><strong>Pain point note</strong><button className="icon-button" onClick={() => onEditPain(pain)} aria-label="Edit note"><MoreHorizontal size={15} /></button></div><p>{pain.description}</p><button className="edit-inline" onClick={() => onEditPain(pain)}>Edit note <ArrowUpRight size={13} /></button></article>) : <EmptyState icon={FileText} title="No notes yet" text="Add a short note about a pain point on this step." />}</>}
        {tab === 'Connections' && <><div className="drawer-section-heading drawer-section-row"><div><span>WORKFLOW LINKS</span><p>Show which steps hand off to or depend on this step.</p></div><button className="button button-quiet button-small" onClick={onAddConnection}><Plus size={14} /> Add link</button></div>{connections.length ? connections.map((connection) => { const outgoing = connection.sourceId === subprocess.id; const otherId = outgoing ? connection.targetId : connection.sourceId; return <div className="drawer-connection" key={connection.id}><div className="connection-symbol">{outgoing ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</div><div><strong>{outgoing ? 'To' : 'From'} {nameById(allSubprocesses, otherId)}</strong><span>{connection.notes || 'Workflow link'}</span></div><button className="icon-button" title="Edit workflow link" onClick={() => onEditConnection(connection)}><MoreHorizontal size={15} /></button><button className="icon-button" title="Remove workflow link" onClick={() => onDeleteConnection(connection)}><Trash2 size={14} /></button></div>; }) : <EmptyState icon={GitBranch} title="No connected steps" text="Add a directed link or draw between nodes in the workflow graph." />}</>}
      </div>
      <div className="drawer-save"><span className="save-check"><Check size={13} /></span><span>Changes save automatically.</span></div>
    </aside>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="drawer-field"><span>{label}</span>{children}</label>;
}

function DialogLayer({ dialog, state, selectedInsurer, user, onClose, onCommit, onToast }: {
  dialog: Dialog; state: WorkspaceState; selectedInsurer?: Insurer; user: User; onClose: () => void; onCommit: Commit; onToast: (value: string) => void;
}) {
  const title = dialog.kind === 'insurer' ? (dialog.insurer ? 'Edit insurer' : 'Add insurance company') : dialog.kind === 'process' ? (dialog.process ? 'Edit process' : 'Add process') : dialog.kind === 'subprocess' ? (dialog.subprocess ? 'Edit subprocess' : 'Add subprocess') : dialog.kind === 'pain' ? (dialog.pain ? 'Edit note' : 'Add pain point note') : dialog.kind === 'evidence' ? 'Add evidence' : dialog.connection ? 'Edit workflow link' : 'Add workflow link';
  const activeSubprocessItems = state.subprocesses.filter((sub) => !sub.archived);
  const defaultConnectionSourceId = dialog.kind === 'connection' ? dialog.connection?.sourceId ?? dialog.sourceId ?? activeSubprocessItems[0]?.id : undefined;
  const saveInsurer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget); const existing = dialog.kind === 'insurer' ? dialog.insurer : undefined;
    const insurer: Insurer = { id: existing?.id ?? newId(), name: String(values.get('name')).trim(), category: String(values.get('category')) as Insurer['category'], website: String(values.get('website')).trim(), description: String(values.get('description')).trim(), ghiAvailability: (String(values.get('ghiAvailability') ?? 'Unknown')) as Insurer['ghiAvailability'], researchStatus: existing?.researchStatus ?? 'Not Started', lastReviewed: existing?.lastReviewed ?? null, researchOwner: String(values.get('researchOwner')).trim(), notes: existing?.notes ?? '' };
    if (!insurer.name) return;
    onCommit((prev) => ({
      ...prev,
      insurers: existing ? prev.insurers.map((item) => item.id === existing.id ? insurer : item) : [...prev.insurers, insurer],
      assessments: existing ? prev.assessments : [...prev.assessments, ...prev.subprocesses.filter((sub) => !sub.archived).map((sub) => blankAssessment(insurer.id, sub.id))],
    }), { type: 'insurer', id: insurer.id, insurerId: insurer.id, summary: existing ? `Updated insurer ${insurer.name}` : `Added insurer ${insurer.name}` }); onClose();
  };
  const saveProcess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (dialog.kind !== 'process') return; const values = new FormData(event.currentTarget); const existing = dialog.process;
    const process: Process = { id: existing?.id ?? newId(), name: String(values.get('name')).trim(), description: String(values.get('description')).trim(), order: existing?.order ?? state.processes.filter((item) => !item.archived).length, archived: false };
    if (!process.name) return;
    onCommit((prev) => ({ ...prev, processes: existing ? prev.processes.map((item) => item.id === existing.id ? process : item) : [...prev.processes, process] }), { type: 'process', id: process.id, summary: existing ? `Renamed process to ${process.name}` : `Added process ${process.name}` }); onClose();
  };
  const saveSubprocess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (dialog.kind !== 'subprocess') return; const values = new FormData(event.currentTarget); const existing = dialog.subprocess;
    const item: Subprocess = { id: existing?.id ?? newId(), processId: dialog.processId, name: String(values.get('name')).trim(), description: String(values.get('description')).trim(), order: existing?.order ?? state.subprocesses.filter((sub) => sub.processId === dialog.processId && !sub.archived).length, archived: false };
    if (!item.name) return;
    onCommit((prev) => ({
      ...prev,
      subprocesses: existing ? prev.subprocesses.map((sub) => sub.id === existing.id ? item : sub) : [...prev.subprocesses, item],
      assessments: existing ? prev.assessments : [...prev.assessments, ...prev.insurers.map((insurer) => blankAssessment(insurer.id, item.id))],
    }), { type: 'subprocess', id: item.id, summary: existing ? `Updated subprocess ${item.name}` : `Added subprocess ${item.name}` }); onClose();
  };
  const savePain = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (dialog.kind !== 'pain') return; const values = new FormData(event.currentTarget); const existing = dialog.pain;
    const item: PainPoint = { id: existing?.id ?? newId(), insurerId: selectedInsurer?.id ?? existing?.insurerId ?? state.insurers[0]!.id, subprocessId: existing?.subprocessId ?? dialog.subprocessId ?? state.subprocesses.find((sub) => !sub.archived)!.id, title: 'Pain point note', description: String(values.get('note')).trim(), failureScenario: existing?.failureScenario ?? '', rootCause: existing?.rootCause ?? '', consequence: existing?.consequence ?? '', businessImpact: existing?.businessImpact ?? 3, frequency: existing?.frequency ?? 3, severity: existing?.severity ?? 'Medium', manualEffortHours: existing?.manualEffortHours ?? 0, workaround: existing?.workaround ?? '', proposedSolution: existing?.proposedSolution ?? '', confidence: existing?.confidence ?? 'Unverified', validation: existing?.validation ?? 'Hypothesis', sourceReferences: existing?.sourceReferences ?? '', createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (!item.description.trim()) return;
    onCommit((prev) => ({ ...prev, painPoints: existing ? prev.painPoints.map((pain) => pain.id === existing.id ? item : pain) : [...prev.painPoints, item] }), { type: 'pain point', id: item.id, insurerId: item.insurerId, summary: existing ? 'Updated pain point note' : 'Added pain point note' }); onClose();
  };  const saveEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (dialog.kind !== 'evidence') return; const values = new FormData(event.currentTarget);
    const item: EvidenceItem = { id: newId(), insurerId: selectedInsurer?.id ?? state.insurers[0]!.id, subprocessId: String(values.get('subprocessId') || '') || null, title: String(values.get('title')).trim(), sourceType: String(values.get('sourceType')) as EvidenceItem['sourceType'], url: String(values.get('url')).trim(), excerpt: String(values.get('excerpt')).trim(), confidence: String(values.get('confidence')) as Confidence, capturedAt: new Date().toISOString(), capturedBy: user.displayName };
    if (!item.title) return;
    onCommit((prev) => ({ ...prev, evidence: [...prev.evidence, item] }), { type: 'evidence', id: item.id, insurerId: item.insurerId, summary: `Added evidence: ${item.title}` }); onClose();
  };
  const saveConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (dialog.kind !== 'connection') return; const values = new FormData(event.currentTarget);
    const sourceId = String(values.get('sourceId')); const targetId = String(values.get('targetId'));
    if (sourceId === targetId) { onToast('Choose two different subprocesses.'); return; }
    const existing = dialog.connection;
    if (!existing && state.connections.some((item) => item.insurerId === (selectedInsurer?.id ?? state.insurers[0]!.id) && item.sourceId === sourceId && item.targetId === targetId)) { onToast('That directed connection already exists.'); return; }
    const item: WorkflowConnection = { id: existing?.id ?? newId(), insurerId: selectedInsurer?.id ?? existing?.insurerId ?? state.insurers[0]!.id, sourceId, targetId, label: `${subprocessRef(state.processes, state.subprocesses, sourceId)} → ${subprocessRef(state.processes, state.subprocesses, targetId)}`, type: existing?.type ?? 'Other', reliability: existing?.reliability ?? 'Unknown', notes: String(values.get('notes')).trim() };
    onCommit((prev) => ({ ...prev, connections: existing ? prev.connections.map((connection) => connection.id === existing.id ? item : connection) : [...prev.connections, item] }), { type: 'connection', id: item.id, insurerId: item.insurerId, summary: `${existing ? 'Updated' : 'Connected'} ${item.label}` }); onClose();
  };
  const form = dialog.kind === 'insurer' ? <form onSubmit={saveInsurer} className="modal-form">
    <Field label="Company name"><input autoFocus name="name" defaultValue={dialog.insurer?.name ?? ''} required placeholder="e.g. Acme Health Insurance" /></Field>
    <Field label="Insurer category"><select name="category" defaultValue={dialog.insurer?.category ?? 'Private General Insurer'}>{['Standalone Health Insurer', 'Private General Insurer', 'Public-Sector General Insurer', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Website"><input name="website" defaultValue={dialog.insurer?.website ?? ''} placeholder="https://example.com" /></Field>
    <Field label="Research owner"><input name="researchOwner" defaultValue={dialog.insurer?.researchOwner ?? ''} placeholder="Team member" /></Field>
    <Field label="Description"><textarea name="description" defaultValue={dialog.insurer?.description ?? ''} rows={3} placeholder="Optional company overview" /></Field>
    {dialog.insurer && <Field label="GHI availability"><select name="ghiAvailability" defaultValue={dialog.insurer.ghiAvailability}>{['Unknown', 'Available', 'Unavailable'].map((value) => <option key={value}>{value}</option>)}</select></Field>}
    <ModalActions onClose={onClose} label={dialog.insurer ? 'Save changes' : 'Add insurer'} />
  </form> : dialog.kind === 'process' ? <form onSubmit={saveProcess} className="modal-form"><Field label="Process name"><input autoFocus name="name" defaultValue={dialog.process?.name ?? ''} required placeholder="e.g. Employer onboarding" /></Field><Field label="Description"><textarea name="description" defaultValue={dialog.process?.description ?? ''} rows={3} placeholder="What happens during this stage?" /></Field><ModalActions onClose={onClose} label={dialog.process ? 'Save process' : 'Add process'} /></form> : dialog.kind === 'subprocess' ? <form onSubmit={saveSubprocess} className="modal-form"><Field label="Parent process"><select value={dialog.processId} disabled>{state.processes.filter((process) => !process.archived).map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}</select></Field><Field label="Subprocess name"><input autoFocus name="name" defaultValue={dialog.subprocess?.name ?? ''} required placeholder="Describe one researchable step" /></Field><Field label="Description"><textarea name="description" defaultValue={dialog.subprocess?.description ?? ''} rows={3} placeholder="Optional details" /></Field><ModalActions onClose={onClose} label={dialog.subprocess ? 'Save subprocess' : 'Add subprocess'} /></form> : dialog.kind === 'pain' ? <form onSubmit={savePain} className="modal-form"><Field label="Pain point note"><textarea autoFocus name="note" defaultValue={dialog.pain?.description ?? ''} rows={7} required placeholder="Write a simple note about this step…" /></Field><ModalActions onClose={onClose} label={dialog.pain ? 'Save note' : 'Add note'} /></form> : dialog.kind === 'evidence' ? <form onSubmit={saveEvidence} className="modal-form"><Field label="Evidence title"><input autoFocus name="title" required placeholder="e.g. Network hospital policy terms" /></Field><Field label="Subprocess"><select name="subprocessId" defaultValue={dialog.subprocessId ?? ''}><option value="">Insurer-wide source</option>{state.subprocesses.filter((sub) => !sub.archived).map((sub) => <option value={sub.id} key={sub.id}>{subprocessRef(state.processes.filter((item) => !item.archived), state.subprocesses.filter((item) => !item.archived), sub.id)} · {sub.name}</option>)}</select></Field><Field label="Source type"><select name="sourceType">{['Insurer website', 'Policy document', 'Regulatory filing', 'Interview', 'Product demo', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="URL"><input name="url" type="url" placeholder="https://" /></Field><Field label="Confidence"><select name="confidence" defaultValue="Unverified">{CONFIDENCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Excerpt or notes"><textarea name="excerpt" rows={4} placeholder="Short source description or relevant quotation" /></Field><ModalActions onClose={onClose} label="Save evidence" /></form> : <form onSubmit={saveConnection} className="modal-form"><Field label="From step"><select name="sourceId" defaultValue={dialog.connection?.sourceId ?? dialog.sourceId ?? activeSubprocessItems[0]?.id}>{state.subprocesses.filter((sub) => !sub.archived).map((sub) => <option key={sub.id} value={sub.id}>{subprocessRef(state.processes.filter((item) => !item.archived), state.subprocesses.filter((item) => !item.archived), sub.id)} · {sub.name}</option>)}</select></Field><Field label="To step"><select name="targetId" defaultValue={dialog.connection?.targetId ?? dialog.targetId ?? activeSubprocessItems.find((sub) => sub.id !== defaultConnectionSourceId)?.id}>{state.subprocesses.filter((sub) => !sub.archived).map((sub) => <option key={sub.id} value={sub.id}>{subprocessRef(state.processes.filter((item) => !item.archived), state.subprocesses.filter((item) => !item.archived), sub.id)} · {sub.name}</option>)}</select></Field><Field label="Link note"><textarea name="notes" rows={3} defaultValue={dialog.connection?.notes ?? ""} placeholder="Optional context for this workflow link" /></Field><ModalActions onClose={onClose} label={dialog.connection ? "Save link" : "Add link"} /></form>
  const archiveItem = () => {
    if (dialog.kind === 'subprocess' && dialog.subprocess) {
      const item = dialog.subprocess;
      onCommit((prev) => ({ ...prev, subprocesses: prev.subprocesses.map((sub) => sub.id === item.id ? { ...sub, archived: true } : sub) }), { type: 'subprocess', id: item.id, summary: `Archived subprocess ${item.name}` });
 onClose();
    }
    if (dialog.kind === 'pain' && dialog.pain) {
      const item = dialog.pain;
      onCommit((prev) => ({ ...prev, painPoints: prev.painPoints.filter((pain) => pain.id !== item.id) }), { type: 'pain point', id: item.id, insurerId: item.insurerId, summary: `Removed pain point ${item.title}` });
 onClose();
    }
    if (dialog.kind === 'connection' && dialog.connection) {
      const item = dialog.connection;
      onCommit((prev) => ({ ...prev, connections: prev.connections.filter((connection) => connection.id !== item.id) }), { type: 'connection', id: item.id, insurerId: item.insurerId, summary: `Removed connection ${item.label}` });
 onClose();
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={`modal-card ${dialog.kind === 'pain' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><div className="section-label">WORKSPACE EDITOR</div><h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div>{form}{((dialog.kind === 'pain' && dialog.pain) || (dialog.kind === 'subprocess' && dialog.subprocess) || (dialog.kind === 'connection' && dialog.connection)) && <div className="modal-remove"><button className="button button-danger" onClick={archiveItem}><Trash2 size={14} />{dialog.kind === 'subprocess' ? 'Archive subprocess' : dialog.kind === 'pain' ? 'Delete note' : 'Delete connection'}</button></div>}</section></div>;
}

function ModalActions({ onClose, label }: { onClose: () => void; label: string }) {
  return <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} />{label}</button></div>;
}

export default App;

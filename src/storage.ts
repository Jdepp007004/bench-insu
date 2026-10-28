import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSeedState } from './data';
import type { User, WorkspaceState } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const remoteEnabled = Boolean(supabaseUrl && supabaseKey);
const supabase: SupabaseClient | null = remoteEnabled ? createClient(supabaseUrl!, supabaseKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

const DB_NAME = 'bench-suite-workspace';
const DB_VERSION = 1;
const STORE = 'workspace';
const LOCAL_KEY = 'main';
const SESSION_KEY = 'bench-suite-user';
const DEMO_USERS: Record<string, string> = { pankaj: 'Pankaj', sakshi: 'Sakshi', dheeraj: 'Dheeraj', vaibhav: 'Vaibhav' };

export interface WorkspaceSnapshot {
  state: WorkspaceState;
  revision: number;
  updatedBy: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local workspace cache'));
  });
}

async function localGet(): Promise<WorkspaceSnapshot | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(LOCAL_KEY);
    request.onsuccess = () => resolve((request.result as WorkspaceSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not read local workspace cache'));
    tx.oncomplete = () => db.close();
  });
}

async function localPut(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot, LOCAL_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not save local workspace cache')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local workspace save was cancelled')); };
  });
}

function usernameFromEmail(email?: string): string {
  return (email ?? '').split('@')[0].toLowerCase();
}

function remoteUser(id: string, email?: string, displayName?: string): User {
  const username = usernameFromEmail(email);
  return { id, username, displayName: displayName || DEMO_USERS[username] || username || 'Researcher' };
}

export async function getCurrentUser(): Promise<User | null> {
  if (supabase) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    return user ? remoteUser(user.id, user.email, user.user_metadata?.display_name) : null;
  }
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) as User : null;
  } catch {
    return null;
  }
}

export async function signIn(usernameInput: string, password: string): Promise<User> {
  const username = usernameInput.trim().toLowerCase();
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: `${username}@bench-suite.ai`, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('The account could not be verified.');
    return remoteUser(data.user.id, data.user.email, data.user.user_metadata?.display_name);
  }
  if (!DEMO_USERS[username] || password !== '1234') throw new Error('Check the username and password and try again.');
  const user = { id: `local-${username}`, username, displayName: DEMO_USERS[username]! };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

export async function signOut(): Promise<void> {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

async function fetchRemote(): Promise<WorkspaceSnapshot> {
  if (!supabase) throw new Error('Shared database is not configured.');
  const { data, error } = await supabase.from('workspace_state').select('payload, revision, updated_by').eq('id', 'main').single();
  if (error) throw new Error(`Could not load the shared workspace: ${error.message}`);
  if (data.payload) return { state: data.payload as WorkspaceState, revision: Number(data.revision), updatedBy: data.updated_by ?? '' };

  const starter = createSeedState();
  try {
    const { data: revision, error: saveError } = await supabase.rpc('save_workspace', {
      p_payload: starter,
      p_expected_revision: Number(data.revision),
    });
    if (saveError) throw saveError;
    return { state: starter, revision: Number(revision), updatedBy: '' };
  } catch {
    const { data: retry, error: retryError } = await supabase.from('workspace_state').select('payload, revision, updated_by').eq('id', 'main').single();
    if (retryError || !retry?.payload) throw new Error('Could not initialize the shared workspace.');
    return { state: retry.payload as WorkspaceState, revision: Number(retry.revision), updatedBy: retry.updated_by ?? '' };
  }
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (supabase) return fetchRemote();
  const stored = await localGet();
  if (stored) return stored;
  const initial = { state: createSeedState(), revision: 1, updatedBy: 'local' };
  await localPut(initial);
  return initial;
}

export async function saveWorkspace(state: WorkspaceState, expectedRevision: number, user: User): Promise<number> {
  if (supabase) {
    const { data, error } = await supabase.rpc('save_workspace', { p_payload: state, p_expected_revision: expectedRevision });
    if (error) {
      if (error.code === '40001' || error.message.includes('workspace_revision_conflict')) {
        throw new Error('Someone else saved a newer version. The latest workspace is loading; reapply your change after it refreshes.');
      }
      throw new Error(`Save failed: ${error.message}`);
    }
    return Number(data);
  }
  const snapshot = { state, revision: expectedRevision + 1, updatedBy: user.id };
  await localPut(snapshot);
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('bench-suite-workspace');
    channel.postMessage(snapshot);
    channel.close();
  }
  return snapshot.revision;
}

export function subscribeWorkspace(onChange: (snapshot: WorkspaceSnapshot) => void): () => void {
  if (supabase) {
    const channel = supabase.channel('bench-suite-workspace-live').on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'workspace_state', filter: 'id=eq.main',
    }, (payload) => {
      const row = payload.new as { payload?: WorkspaceState; revision?: number; updated_by?: string };
      if (row.payload) onChange({ state: row.payload, revision: Number(row.revision), updatedBy: row.updated_by ?? '' });
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel('bench-suite-workspace');
  channel.onmessage = (event: MessageEvent<WorkspaceSnapshot>) => onChange(event.data);
  return () => channel.close();
}

export function sourceLabel(): string {
  return remoteEnabled ? 'Supabase shared workspace' : 'IndexedDB local preview';
}

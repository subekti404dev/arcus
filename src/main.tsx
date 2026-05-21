import React, { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { createRoot } from 'react-dom/client';
import { parseCurl } from './curl';
import { sendNativeHttpRequest } from './http';
import { JsonTree, type JsonValue } from './JsonTree';
import { importPostmanCollection, exportAsPostmanCollection } from './postman';
import Dropdown from './Dropdown';
import { loadJson, saveJson } from './storage';
import type { AuthState, AuthType, Collection, CollectionFolder, Environment, HeaderRow, HttpMethod, QueryRow } from './types';
import curlIcon from './assets/curl.svg';
import importCollectionIcon from './assets/import-collection.svg';
import codeSquareIcon from './assets/code-square.svg';
import saveIcon from './assets/save.svg';
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from './windowControls';
import './styles.css';
type TreeDragData = { type: 'request' | 'folder'; collectionId: string; id: string };
type TreeDropData = { type: 'root' | 'folder'; collectionId: string; folderId?: string };

function DraggableTreeButton({ payload, className, onClick, title, children }: { payload: TreeDragData; className?: string; onClick?: () => void; title: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `tree-${payload.type}-${payload.id}`, data: payload });
  return (
    <button
      ref={setNodeRef}
      className={className}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.55 : undefined }}
      {...listeners}
      {...attributes}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function TreeDropZone({ drop, className, children }: { drop: TreeDropData; className?: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${drop.collectionId}-${drop.folderId ?? 'root'}`, data: drop });
  return <div ref={setNodeRef} className={`${className ?? ''}${isOver ? ' drag-over-root' : ''}`}>{children}</div>;
}

type RequestHistory = {
  id: string;
  method: HttpMethod;
  url: string;
  status?: number;
  durationMs?: number;
  createdAt: string;
  createdAtMs: number;
  snapshot: RequestSnapshot;
  response?: ResponseState;
};

type ResponseTimings = {
  totalMs: number;
  uploadMs: number;
  downloadMs: number;
  firstByteMs: number;
  bodyReadMs: number;
};

type ResponseState = {
  status: number;
  statusText: string;
  durationMs: number;
  timings: ResponseTimings;
  headers: Record<string, string>;
  body: string;
  bodyBase64?: string | null;
};

type BodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded';
type BodyRow = { id: string; key: string; value: string; enabled: boolean; fieldType: 'text' | 'file' };

type RequestSnapshot = {
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  queryRows: QueryRow[];
  body: string;
  bodyType: BodyType;
  bodyRows: BodyRow[];
  auth: AuthState;
  requestName: string;
  activeSavedRequestId: string;
  selectedCollectionId: string;
  response: ResponseState | null;
  error: string;
};

type RequestTab = {
  id: string;
  title: string;
  dirty: boolean;
  sourceKey?: string;
  snapshot: RequestSnapshot;
};

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const collectionsStorageKey = 'arcus:collections';
const historyStorageKey = 'arcus:history';
const historyRetentionMs = 2 * 24 * 60 * 60 * 1000;
const environmentsStorageKey = 'arcus:environments';
const activeEnvStorageKey = 'arcus:activeEnv';

function methodColorClass(method: string) {
  return `method-${method.toLowerCase()}`;
}

function uid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function parseJson(value: string): JsonValue | null {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}

function prettyJson(value: string) {
  const parsed = parseJson(value);
  return parsed === null ? value : JSON.stringify(parsed, null, 2);
}

function getContentType(headers: Record<string, string>) {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  return entry?.[1] ?? '';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightSnippet(code: string) {
  const escaped = escapeHtml(code);
  return escaped
    .replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-string">$1</span>')
    .replace(/\b(import|from|const|await|fetch|console|log|response|requests|request|print|curl)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(GET|POST|PUT|PATCH|DELETE|HEAD)\b/g, '<span class="tok-method">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="tok-number">$1</span>')
    .replace(/(--[\w-]+|-X|-H|-F)\b/g, '<span class="tok-flag">$1</span>');
}

function defaultHeaders(): HeaderRow[] {
  return [{ id: uid(), key: 'Accept', value: 'application/json', enabled: true }];
}

function defaultBodyRows(): BodyRow[] {
  return [{ id: uid(), key: '', value: '', enabled: true, fieldType: 'text' }];
}

function defaultAuth(): AuthState {
  return { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKey: '', apiValue: '', apiIn: 'header' };
}

function createBlankSnapshot(): RequestSnapshot {
  return {
    method: 'GET',
    url: '',
    headers: defaultHeaders(),
    queryRows: [],
    body: '',
    bodyType: 'raw',
    bodyRows: defaultBodyRows(),
    auth: defaultAuth(),
    requestName: '',
    activeSavedRequestId: '',
    selectedCollectionId: '',
    response: null,
    error: '',
  };
}

function tabTitle(snapshot: RequestSnapshot) {
  return snapshot.requestName || snapshot.url || 'New Request';
}

function App() {
  const [tabs, setTabs] = useState<RequestTab[]>(() => {
    const snapshot = createBlankSnapshot();
    return [{ id: uid(), title: tabTitle(snapshot), dirty: false, snapshot }];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderRow[]>(() => defaultHeaders());
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState<BodyType>('raw');
  const [bodyRows, setBodyRows] = useState<BodyRow[]>(() => defaultBodyRows());
  const [queryRows, setQueryRows] = useState<QueryRow[]>([]);

  function buildQueryString(rows: QueryRow[]): string {
    const params = rows
      .filter((r) => r.enabled && r.key.trim())
      .map((r) => `${encodeURIComponent(r.key.trim())}=${encodeURIComponent(r.value)}`);
    return params.length > 0 ? `?${params.join('&')}` : '';
  }

  function toggleSidebar() {
    const next = !sidebarVisible;
    localStorage.setItem('arcus:sidebar', String(next));
    setSidebarVisible(next);
  }

  function setUrlPreservingQuery(raw: string) {
    const idx = raw.indexOf('?');
    if (idx === -1) {
      setQueryRows([]);
      setUrl(raw);
      return;
    }
    const newBase = raw.slice(0, idx);
    const newSearch = raw.slice(idx + 1);
    const newRows: QueryRow[] = [];
    for (const pair of newSearch.split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) {
        if (pair.trim()) newRows.push({ id: uid(), key: decodeURIComponent(pair.trim()), value: '', enabled: true });
      } else {
        const k = decodeURIComponent(pair.slice(0, eq).trim());
        const v = decodeURIComponent(pair.slice(eq + 1));
        if (k) newRows.push({ id: uid(), key: k, value: v, enabled: true });
      }
    }
    setQueryRows(newRows);
    setUrl(raw);
  }

  function setUrlFromQueryRows(rows: QueryRow[]) {
    setQueryRows(rows);
    const qs = buildQueryString(rows);
    const base = (url.split('?')[0] ?? '').trim();
    setUrl(qs ? `${base}${qs}` : base);
  }
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [history, setHistory] = useState<RequestHistory[]>(() => loadJson<RequestHistory[]>(historyStorageKey, [])
    .filter((item) => item.createdAtMs && Date.now() - item.createdAtMs <= historyRetentionMs)
    .sort((a, b) => b.createdAtMs - a.createdAtMs));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [curlInput, setCurlInput] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const toastTimeoutRef = useRef<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(() => localStorage.getItem('arcus:sidebar') !== 'false');
  const [showImportModal, setShowImportModal] = useState(false);
  const [responseView, setResponseView] = useState<'preview' | 'raw' | 'headers'>('preview');
  const [showTimingBreakdown, setShowTimingBreakdown] = useState(false);
  const [showSnippetModal, setShowSnippetModal] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useState<'curl' | 'fetch' | 'axios' | 'python'>('curl');
  const [auth, setAuth] = useState<AuthState>(() => defaultAuth());
  const [collections, setCollections] = useState<Collection[]>(() => loadJson<Collection[]>(collectionsStorageKey, []));
  const [environments, setEnvironments] = useState<Environment[]>(() => loadJson<Environment[]>(environmentsStorageKey, []));
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string>(() => localStorage.getItem(activeEnvStorageKey) ?? '');
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState<string>('');
  const [envName, setEnvName] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string; enabled: boolean }[]>([]);
  const [bulkEditEnvVars, setBulkEditEnvVars] = useState(false);
  const [bulkEnvVarsRaw, setBulkEnvVarsRaw] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState(''); // sidebar selection only
  const [requestName, setRequestName] = useState('');
  const [activeSavedRequestId, setActiveSavedRequestId] = useState('');
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState('');
  const [deleteTargetCollectionId, setDeleteTargetCollectionId] = useState('');
  const [folderModalCollectionId, setFolderModalCollectionId] = useState('');
  const [folderModalParentId, setFolderModalParentId] = useState('');
  const [folderModalName, setFolderModalName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState('');
  const [deleteTargetFolder, setDeleteTargetFolder] = useState<{ collectionId: string; folderId: string; name: string; requestCount: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingRequestId, setRenamingRequestId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [menuState, setMenuState] = useState<{ requestId: string; collectionId: string; rect: DOMRect; name: string } | null>(null);
  const [collectionMenuState, setCollectionMenuState] = useState<{ collectionId: string; rect: DOMRect; name: string } | null>(null);
  const [folderMenuState, setFolderMenuState] = useState<{ collectionId: string; folderId: string; rect: DOMRect; name: string } | null>(null);
  const [deleteTargetRequest, setDeleteTargetRequest] = useState<{ collectionId: string; requestId: string; name: string } | null>(null);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalCollectionId, setSaveModalCollectionId] = useState('');
  const [saveModalFolderId, setSaveModalFolderId] = useState('');
  const [saveModalNewName, setSaveModalNewName] = useState('');
  const [saveModalSelectedRequestId, setSaveModalSelectedRequestId] = useState('');
  const [bulkEditHeaders, setBulkEditHeaders] = useState(false);
  const [bulkHeadersRaw, setBulkHeadersRaw] = useState('');
  const [bulkEditQuery, setBulkEditQuery] = useState(false);
  const [bulkQueryRaw, setBulkQueryRaw] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const hydratingTabRef = useRef(false);
  const tabsRef = useRef<RequestTab[]>(tabs);

  function currentSnapshot(): RequestSnapshot {
    return { method, url, headers, queryRows, body, bodyType, bodyRows, auth, requestName, activeSavedRequestId, selectedCollectionId, response, error };
  }

  function applySnapshot(snapshot: RequestSnapshot) {
    hydratingTabRef.current = true;
    setMethod(snapshot.method);
    setUrl(snapshot.url);
    setHeaders(snapshot.headers);
    setQueryRows(snapshot.queryRows);
    setBody(snapshot.body);
    setBodyType(snapshot.bodyType);
    setBodyRows(snapshot.bodyRows.length > 0 ? snapshot.bodyRows : defaultBodyRows());
    setAuth(snapshot.auth);
    setRequestName(snapshot.requestName);
    setActiveSavedRequestId(snapshot.activeSavedRequestId);
    setSelectedCollectionId(snapshot.selectedCollectionId);
    setResponse(snapshot.response ?? null);
    setError(snapshot.error ?? '');
    setBulkEditHeaders(false);
    setBulkEditQuery(false);
    queueMicrotask(() => { hydratingTabRef.current = false; });
  }

  const canHaveBody = !['GET', 'HEAD', 'DELETE'].includes(method);

  function statusBadgeClass(status: number) {
    if (status < 300) return 'status-2xx';
    if (status < 400) return 'status-3xx';
    if (status < 500) return 'status-4xx';
    return 'status-5xx';
  }

  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    const q = searchQuery.toLowerCase();
    return collections.reduce<Collection[]>((acc, collection) => {
      const collectionNameMatches = collection.name.toLowerCase().includes(q);
      const matchingRequests = collectionNameMatches
        ? collection.requests
        : collection.requests.filter((r) => r.name.toLowerCase().includes(q) || r.method.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));

      if (collectionNameMatches || matchingRequests.length > 0) {
        acc.push({ ...collection, requests: matchingRequests });
      }
      return acc;
    }, []);
  }, [collections, searchQuery]);
  const responseJson = useMemo(() => response ? parseJson(response.body) : null, [response]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    if (hydratingTabRef.current || !activeTabId) return;
    const snapshot = currentSnapshot();
    setTabs((items) => items.map((tab) => tab.id === activeTabId ? { ...tab, title: tabTitle(snapshot), dirty: true, snapshot } : tab));
  }, [method, url, headers, queryRows, body, bodyType, bodyRows, auth, requestName, activeSavedRequestId, selectedCollectionId, response, error]);

  useEffect(() => {
    saveJson(collectionsStorageKey, collections);
  }, [collections]);

  useEffect(() => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    if (!toastMessage) return;
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage('');
      toastTimeoutRef.current = null;
    }, 2600);
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [toastMessage]);

  useEffect(() => {
    const freshHistory = history.filter((item) => item.createdAtMs && Date.now() - item.createdAtMs <= historyRetentionMs).slice(0, 20);
    saveJson(historyStorageKey, freshHistory);
    if (freshHistory.length !== history.length) setHistory(freshHistory);
  }, [history]);

  useEffect(() => {
    saveJson(environmentsStorageKey, environments);
  }, [environments]);

  useEffect(() => {
    localStorage.setItem(activeEnvStorageKey, activeEnvironmentId);
  }, [activeEnvironmentId]);

  const activeEnvironment = useMemo(() => environments.find((e) => e.id === activeEnvironmentId), [environments, activeEnvironmentId]);

  function resolveVariables(text: string): string {
    if (!activeEnvironment) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const variable = activeEnvironment.variables.find((v) => v.enabled && v.key === name);
      return variable ? variable.value : `{{${name}}}`;
    });
  }

  const effectiveUrl = useMemo(() => {
    let resolved = resolveVariables(url);
    if (auth.type === 'apikey' && auth.apiIn === 'query' && auth.apiKey.trim() && auth.apiValue.trim()) {
      const separator = resolved.includes('?') ? '&' : '?';
      return `${resolved}${separator}${encodeURIComponent(auth.apiKey.trim())}=${encodeURIComponent(auth.apiValue.trim())}`;
    }
    return resolved;
  }, [url, auth, activeEnvironment]);

  const activeHeaders = useMemo(() => {
    return headers.reduce<Record<string, string>>((acc, row) => {
      if (row.enabled && row.key.trim()) acc[row.key.trim()] = row.value;
      return acc;
    }, {});
  }, [headers]);

  const resolvedBody = useMemo(() => resolveVariables(body), [body, activeEnvironment]);

  const encodedBody = useMemo(() => {
    const rows = bodyRows.filter((row) => row.enabled && row.key.trim()).map((row) => ({ ...row, key: resolveVariables(row.key), value: resolveVariables(row.value) }));
    if (bodyType === 'x-www-form-urlencoded') {
      return new URLSearchParams(rows.map((row) => [row.key, row.value])).toString();
    }
    if (bodyType === 'form-data') {
      const formData = new FormData();
      rows.forEach((row) => formData.append(row.key, row.value));
      return formData;
    }
    return body;
  }, [body, bodyRows, bodyType]);

  const requestHeaders = useMemo(() => {
    const nextHeaders: Record<string, string> = {};

    // Auth-generated headers
    if (auth.type === 'bearer' && auth.bearerToken.trim()) {
      nextHeaders['Authorization'] = `Bearer ${auth.bearerToken.trim()}`;
    }
    if (auth.type === 'basic' && auth.basicUsername.trim()) {
      nextHeaders['Authorization'] = `Basic ${btoa(`${auth.basicUsername}:${auth.basicPassword}`)}`;
    }
    if (auth.type === 'apikey' && auth.apiIn === 'header' && auth.apiKey.trim() && auth.apiValue.trim()) {
      nextHeaders[auth.apiKey.trim()] = auth.apiValue;
    }

    // User headers (can override auth if needed)
    Object.entries(activeHeaders).forEach(([key, value]) => {
      nextHeaders[resolveVariables(key)] = resolveVariables(value);
    });

    if (bodyType === 'x-www-form-urlencoded') {
      nextHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (bodyType === 'form-data') {
      Object.keys(nextHeaders).forEach((key) => {
        if (key.toLowerCase() === 'content-type') delete nextHeaders[key];
      });
    }
    return nextHeaders;
  }, [activeHeaders, auth, bodyType]);

  async function sendWithFetch() {
    const startedAt = performance.now();
    let fetchBody: BodyInit | undefined;
    if (canHaveBody && bodyType === 'form-data') {
      const fd = new FormData();
      bodyRows.filter(r => r.enabled && r.key.trim()).forEach(r => {
        if (r.fieldType === 'file' && r.value) {
          // For browser fetch, we can't read local file paths — skip file fields
          fd.append(r.key.trim(), new Blob([]), r.value.split('/').pop() || 'file');
        } else {
          fd.append(r.key.trim(), r.value);
        }
      });
      if (Array.from(fd.entries()).length > 0) fetchBody = fd;
    } else if (canHaveBody && (bodyType !== 'raw' || body.trim())) {
      fetchBody = encodedBody;
    }
    const res = await fetch(effectiveUrl, {
      method,
      headers: requestHeaders,
      body: fetchBody,
    });
    const headersReceivedAt = performance.now();
    const text = await res.text();
    const completedAt = performance.now();
    const headers = Object.fromEntries(res.headers.entries());
    const totalMs = Math.round(completedAt - startedAt);
    const firstByteMs = Math.round(headersReceivedAt - startedAt);
    const bodyReadMs = Math.round(completedAt - headersReceivedAt);
    return {
      status: res.status,
      statusText: res.statusText,
      durationMs: totalMs,
      timings: {
        totalMs,
        uploadMs: firstByteMs,
        downloadMs: bodyReadMs,
        firstByteMs,
        bodyReadMs,
      },
      headers,
      body: text,
      bodyBase64: getContentType(headers).toLowerCase().startsWith('image/') ? btoa(text) : null,
    };
  }

  async function sendRequest() {
    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const result = window.__TAURI_INTERNALS__
        ? await sendNativeHttpRequest({
            method, url: effectiveUrl,
            headers: Object.entries(requestHeaders).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
            body: bodyType !== 'form-data' ? (bodyType === 'raw' ? resolvedBody : String(encodedBody)) : undefined,
            formFields: bodyType === 'form-data' ? bodyRows.filter(r => r.enabled && r.key.trim()).map(r => ({ key: r.key.trim(), value: r.value, fieldType: r.fieldType })) : undefined,
          })
        : await sendWithFetch();

      const durationMs = 'duration_ms' in result ? Number(result.duration_ms) : result.durationMs;
      let timings: ResponseTimings;
      if ('duration_ms' in result && result.timings) {
        timings = {
          totalMs: Number(result.timings.total_ms),
          uploadMs: Number(result.timings.upload_ms),
          downloadMs: Number(result.timings.download_ms),
          firstByteMs: Number(result.timings.first_byte_ms),
          bodyReadMs: Number(result.timings.body_read_ms),
        };
      } else if (!('duration_ms' in result) && result.timings) {
        timings = result.timings;
      } else {
        timings = { totalMs: durationMs, uploadMs: durationMs, downloadMs: 0, firstByteMs: durationMs, bodyReadMs: 0 };
      }
      const nextResponse: ResponseState = {
        status: result.status,
        statusText: 'status_text' in result ? result.status_text : result.statusText,
        durationMs,
        timings,
        headers: result.headers,
        body: prettyJson(result.body),
        bodyBase64: 'body_base64' in result ? result.body_base64 : (!('duration_ms' in result) ? result.bodyBase64 : null),
      };
      const snapshot = { ...currentSnapshot(), url: effectiveUrl, response: nextResponse, error: '' };
      setResponse(nextResponse);
      setResponseView('preview');
      setTabs((items) => items.map((tab) => tab.id === activeTabId ? { ...tab, snapshot } : tab));
      setHistory((items) => [
        { id: uid(), method, url: effectiveUrl, status: result.status, durationMs: nextResponse.durationMs, createdAt: new Date().toLocaleString(), createdAtMs: Date.now(), snapshot, response: nextResponse },
        ...items.filter((item) => item.createdAtMs && Date.now() - item.createdAtMs <= historyRetentionMs).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 19),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown request error';
      const snapshot = { ...currentSnapshot(), url: effectiveUrl, response: null, error: message };
      setError(message);
      setTabs((items) => items.map((tab) => tab.id === activeTabId ? { ...tab, snapshot } : tab));
      setHistory((items) => [
        { id: uid(), method, url: effectiveUrl, createdAt: new Date().toLocaleString(), createdAtMs: Date.now(), snapshot },
        ...items.filter((item) => item.createdAtMs && Date.now() - item.createdAtMs <= historyRetentionMs).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 19),
      ]);
    } finally {
      setLoading(false);
    }
  }

  function updateHeader(id: string, patch: Partial<HeaderRow>) {
    setHeaders((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function updateBodyRow(id: string, patch: Partial<BodyRow>) {
    setBodyRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function updateQueryRow(id: string, patch: Partial<QueryRow>) {
    const next = queryRows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    setUrlFromQueryRows(next);
  }

  function deleteQueryRow(id: string) {
    const next = queryRows.filter((r) => r.id !== id);
    setUrlFromQueryRows(next);
  }

  function setActiveTab(tabId: string) {
    const current = currentSnapshot();
    const latestTabs = tabsRef.current;
    const nextTab = latestTabs.find((tab) => tab.id === tabId);
    if (!nextTab) return;

    const nextTabs = latestTabs.map((tab) => tab.id === activeTabId ? { ...tab, title: tabTitle(current), snapshot: current } : tab);
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveTabId(tabId);
    applySnapshot(nextTab.snapshot);
  }

  function newTab(snapshot = createBlankSnapshot(), dirty = false, sourceKey?: string) {
    const current = currentSnapshot();
    const latestTabs = tabsRef.current;
    const existing = sourceKey ? latestTabs.find((tab) => tab.sourceKey === sourceKey) : undefined;
    const nextTab = existing ?? { id: uid(), title: tabTitle(snapshot), dirty, sourceKey, snapshot };
    const updatedTabs = latestTabs
      .map((tab) => tab.id === activeTabId ? { ...tab, title: tabTitle(current), snapshot: current } : tab);
    const nextTabs = existing ? updatedTabs : [...updatedTabs, nextTab];

    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveTabId(nextTab.id);
    applySnapshot(nextTab.snapshot);
  }

  function closeTab(tabId: string) {
    const latestTabs = tabsRef.current;
    if (latestTabs.length === 1) {
      const blank = createBlankSnapshot();
      const resetTabs = [{ id: tabId, title: tabTitle(blank), dirty: false, snapshot: blank }];
      tabsRef.current = resetTabs;
      setTabs(resetTabs);
      applySnapshot(blank);
      return;
    }
    const index = latestTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = latestTabs.filter((tab) => tab.id !== tabId);
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    if (tabId === activeTabId) {
      const nextTab = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      setActiveTabId(nextTab.id);
      applySnapshot(nextTab.snapshot);
    }
  }

  function closeOtherTabs(tabId: string) {
    const target = tabsRef.current.find((tab) => tab.id === tabId);
    if (!target) return;
    tabsRef.current = [target];
    setTabs([target]);
    setActiveTabId(target.id);
    applySnapshot(target.snapshot);
    setTabMenu(null);
  }

  function closeAllTabs() {
    const blank = createBlankSnapshot();
    const resetTabs = [{ id: uid(), title: tabTitle(blank), dirty: false, snapshot: blank }];
    tabsRef.current = resetTabs;
    setTabs(resetTabs);
    setActiveTabId(resetTabs[0].id);
    applySnapshot(blank);
    setTabMenu(null);
  }

  function openTabMenu(event: React.MouseEvent, tabId: string) {
    event.preventDefault();
    setActiveTab(tabId);
    setTabMenu({ tabId, x: event.clientX, y: event.clientY });
  }

  function openCollectionModal(collection?: Collection) {
    if (collection) {
      setEditingCollectionId(collection.id);
      setNewCollectionName(collection.name);
    } else {
      setEditingCollectionId('');
      setNewCollectionName('');
    }
    setShowCollectionModal(true);
  }

  function saveCollection() {
    if (!newCollectionName.trim()) return;
    const now = new Date().toISOString();
    if (editingCollectionId) {
      setCollections((items) => items.map((collection) => collection.id === editingCollectionId ? { ...collection, name: newCollectionName.trim(), updatedAt: now } : collection));
    } else {
      const collection: Collection = { id: uid(), name: newCollectionName.trim(), requests: [], createdAt: now, updatedAt: now };
      setCollections((items) => [collection, ...items]);
      setSelectedCollectionId(collection.id);
    }
    setNewCollectionName('');
    setEditingCollectionId('');
    setShowCollectionModal(false);
  }

  function openEnvEditor(env?: Environment) {
    if (env) {
      setEditingEnvId(env.id);
      setEnvName(env.name);
      setEnvVars(env.variables);
      setBulkEditEnvVars(false);
      setBulkEnvVarsRaw('');
    } else {
      setEditingEnvId('');
      setEnvName('');
      setEnvVars([]);
      setBulkEditEnvVars(false);
      setBulkEnvVarsRaw('');
    }
    setShowEnvEditor(true);
  }

  function saveEnvironment() {
    if (!envName.trim()) return;
    const now = new Date().toISOString();
    const variables = envVars.filter((v) => v.key.trim());
    if (editingEnvId) {
      setEnvironments((prev) => prev.map((e) => e.id === editingEnvId ? { ...e, name: envName.trim(), variables, updatedAt: now } : e));
    } else {
      const env: Environment = { id: uid(), name: envName.trim(), variables, createdAt: now, updatedAt: now };
      setEnvironments((prev) => [...prev, env]);
      setActiveEnvironmentId(env.id);
    }
    setShowEnvEditor(false);
  }

  function deleteEnvironment(id: string) {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    if (activeEnvironmentId === id) setActiveEnvironmentId('');
    setShowEnvEditor(false);
  }

  function deleteCollection(collectionId: string) {
    setCollections((items) => items.filter((collection) => collection.id !== collectionId));
    if (selectedCollectionId === collectionId) setSelectedCollectionId('');
    setDeleteTargetCollectionId('');
  }

  function openDeleteCollectionModal(collectionId: string) {
    setDeleteTargetCollectionId(collectionId);
  }

  function openFolderModal(collectionId: string, folder?: CollectionFolder, parentId = '') {
    setFolderModalCollectionId(collectionId);
    setFolderModalParentId(folder?.parentId ?? parentId);
    setEditingFolderId(folder?.id ?? '');
    setFolderModalName(folder?.name ?? '');
  }

  function saveFolder() {
    if (!folderModalCollectionId || !folderModalName.trim()) return;
    const now = new Date().toISOString();
    setCollections((items) => items.map((collection) => {
      if (collection.id !== folderModalCollectionId) return collection;
      const folders = collection.folders ?? [];
      if (editingFolderId) {
        return {
          ...collection,
          updatedAt: now,
          folders: folders.map((folder) => folder.id === editingFolderId ? { ...folder, name: folderModalName.trim(), parentId: folderModalParentId || undefined, updatedAt: now } : folder),
        };
      }
      return {
        ...collection,
        updatedAt: now,
        folders: [{ id: uid(), name: folderModalName.trim(), parentId: folderModalParentId || undefined, createdAt: now, updatedAt: now }, ...folders],
      };
    }));
    setFolderModalCollectionId('');
    setFolderModalParentId('');
    setEditingFolderId('');
    setFolderModalName('');
  }

  function openDeleteFolderModal(collectionId: string, folder: CollectionFolder) {
    const collection = collections.find((item) => item.id === collectionId);
    const requestCount = collection?.requests.filter((request) => request.folderId === folder.id).length ?? 0;
    setDeleteTargetFolder({ collectionId, folderId: folder.id, name: folder.name, requestCount });
  }

  function deleteFolder() {
    if (!deleteTargetFolder) return;
    const now = new Date().toISOString();
    setCollections((items) => items.map((collection) => {
      if (collection.id !== deleteTargetFolder.collectionId) return collection;
      return {
        ...collection,
        updatedAt: now,
        folders: (collection.folders ?? []).filter((folder) => folder.id !== deleteTargetFolder.folderId),
        requests: collection.requests.map((request) => request.folderId === deleteTargetFolder.folderId ? { ...request, folderId: undefined, updatedAt: now } : request),
      };
    }));
    setDeleteTargetFolder(null);
  }

  const saveModalCollection = useMemo(() => {
    return collections.find((c) => c.id === saveModalCollectionId);
  }, [collections, saveModalCollectionId]);

  const saveModalFolders = useMemo(() => {
    return saveModalCollection?.folders ?? [];
  }, [saveModalCollection]);

  function folderDisplayName(folder: CollectionFolder, folders: CollectionFolder[] = []) {
    const names = [folder.name];
    let parentId = folder.parentId;
    const seen = new Set([folder.id]);
    while (parentId && !seen.has(parentId)) {
      const parent = folders.find((item) => item.id === parentId);
      if (!parent) break;
      names.unshift(parent.name);
      seen.add(parent.id);
      parentId = parent.parentId;
    }
    return names.join(' / ');
  }

  function orderedFoldersForTree(folders: CollectionFolder[]) {
    const folderIds = new Set(folders.map((folder) => folder.id));
    const ordered: CollectionFolder[] = [];
    const appendChildren = (parentId?: string) => {
      folders
        .filter((folder) => (folder.parentId || '') === (parentId || ''))
        .forEach((folder) => {
          ordered.push(folder);
          appendChildren(folder.id);
        });
    };
    folders
      .filter((folder) => !folder.parentId || !folderIds.has(folder.parentId))
      .forEach((folder) => {
        ordered.push(folder);
        appendChildren(folder.id);
      });
    return ordered;
  }

  const saveModalRequests = useMemo(() => {
    return (saveModalCollection?.requests ?? []).filter((request) => (request.folderId ?? '') === saveModalFolderId);
  }, [saveModalCollection, saveModalFolderId]);

  function toggleBulkHeaders() {
    if (!bulkEditHeaders) {
      setBulkHeadersRaw(headers.map((h) => (h.enabled ? '' : '// ') + `${h.key}: ${h.value}`).join('\n'));
      setBulkEditHeaders(true);
    } else {
      applyBulkHeaders(bulkHeadersRaw);
      setBulkEditHeaders(false);
    }
  }

  function handleBulkHeadersChange(text: string) {
    setBulkHeadersRaw(text);
    applyBulkHeaders(text);
  }

  function handleBulkCommentToggle(
    text: string,
    textarea: HTMLTextAreaElement,
    setter: (text: string) => void,
  ) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++;

    const selected = text.slice(lineStart, lineEnd);
    const lines = selected.split('\n');

    const allCommented = lines.every((line) => line.trimStart().startsWith('//'));
    const toggled = lines.map((line) => {
      if (allCommented) {
        const idx = line.indexOf('//');
        return idx >= 0 ? line.slice(0, idx) + line.slice(idx + 2) : line;
      }
      return `// ${line}`;
    }).join('\n');

    const next = text.slice(0, lineStart) + toggled + text.slice(lineEnd);
    setter(next);

    requestAnimationFrame(() => {
      textarea.focus();
      const newEnd = allCommented ? Math.max(0, lineEnd - (lines.length * 3)) : lineEnd + (lines.length * 3);
      textarea.setSelectionRange(lineStart, newEnd);
    });
  }

  function handleBulkHeadersKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      handleBulkCommentToggle(bulkHeadersRaw, e.currentTarget, (text) => {
        setBulkHeadersRaw(text);
        applyBulkHeaders(text);
      });
    }
  }

  function handleBulkQueryKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      handleBulkCommentToggle(bulkQueryRaw, e.currentTarget, (text) => {
        setBulkQueryRaw(text);
        applyBulkQuery(text);
      });
    }
  }

  function handleBulkEnvVarsKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      handleBulkCommentToggle(bulkEnvVarsRaw, e.currentTarget, (text) => {
        setBulkEnvVarsRaw(text);
        applyBulkEnvVars(text);
      });
    }
  }

  function toggleBulkEnvVars() {
    if (!bulkEditEnvVars) {
      setBulkEnvVarsRaw(envVars.filter((v) => v.key.trim() || v.value.trim()).map((v) => (v.enabled ? '' : '// ') + `${v.key}: ${v.value}`).join('\n'));
      setBulkEditEnvVars(true);
    } else {
      applyBulkEnvVars(bulkEnvVarsRaw);
      setBulkEditEnvVars(false);
    }
  }

  function handleBulkEnvVarsChange(text: string) {
    setBulkEnvVarsRaw(text);
    applyBulkEnvVars(text);
  }

  function applyBulkEnvVars(text: string) {
    const parsed: { key: string; value: string; enabled: boolean }[] = [];
    for (const line of text.split('\n')) {
      const hasPrefix = line.trimStart().startsWith('//');
      const content = hasPrefix ? line.trimStart().slice(2) : line;
      const idx = content.indexOf(':');
      if (idx === -1) continue;
      const key = content.slice(0, idx).trim();
      const value = content.slice(idx + 1).trim();
      if (key) parsed.push({ key, value, enabled: !hasPrefix });
    }
    setEnvVars(parsed);
  }

  function applyBulkHeaders(text: string) {
    const parsed: HeaderRow[] = [];
    for (const line of text.split('\n')) {
      const hasPrefix = line.trimStart().startsWith('//');
      const content = hasPrefix ? line.trimStart().slice(2) : line;
      const idx = content.indexOf(':');
      if (idx === -1) continue;
      const key = content.slice(0, idx).trim();
      const value = content.slice(idx + 1).trim();
      if (key) parsed.push({ id: uid(), key, value, enabled: !hasPrefix });
    }
    setHeaders(parsed.length > 0 ? parsed : defaultHeaders());
  }

  function openSaveModal() {
    if (!url.trim()) return;
    const collectionId = selectedCollectionId || (collections.length > 0 ? collections[0].id : '');
    const activeSavedRequest = collections.find((collection) => collection.id === collectionId)?.requests.find((request) => request.id === activeSavedRequestId);
    setSaveModalNewName(requestName || `${method} ${url}`);
    setSaveModalCollectionId(collectionId);
    setSaveModalFolderId(activeSavedRequest?.folderId ?? '');
    setSaveModalSelectedRequestId(activeSavedRequestId && selectedCollectionId ? activeSavedRequestId : '');
    setShowSaveModal(true);
  }

  function toggleBulkQuery() {
    if (!bulkEditQuery) {
      setBulkQueryRaw(queryRows.filter((r) => r.key.trim() || r.value.trim()).map((r) => (r.enabled ? '' : '// ') + `${r.key}: ${r.value}`).join('\n'));
      setBulkEditQuery(true);
    } else {
      applyBulkQuery(bulkQueryRaw);
      setBulkEditQuery(false);
    }
  }

  function handleBulkQueryChange(text: string) {
    setBulkQueryRaw(text);
    applyBulkQuery(text);
  }

  function applyBulkQuery(text: string) {
    const rows: QueryRow[] = [];
    for (const line of text.split('\n')) {
      const hasPrefix = line.trimStart().startsWith('//');
      const content = hasPrefix ? line.trimStart().slice(2) : line;
      const idx = content.indexOf(':');
      if (idx === -1) continue;
      const key = content.slice(0, idx).trim();
      const value = content.slice(idx + 1).trim();
      if (key) rows.push({ id: uid(), key, value, enabled: !hasPrefix });
    }
    setUrlFromQueryRows(rows);
  }

  function doSaveRequest() {
    if (!saveModalCollectionId || !url.trim()) return;
    const now = new Date().toISOString();
    const name = saveModalNewName.trim() || `${method} ${url}`;

    setCollections((items) => items.map((collection) => {
      if (collection.id !== saveModalCollectionId) return collection;

      if (saveModalSelectedRequestId) {
        return {
          ...collection,
          updatedAt: now,
          requests: collection.requests.map((request) => request.id === saveModalSelectedRequestId ? {
            ...request, name, folderId: saveModalFolderId || undefined, method, url, headers, queryParams: queryRows, body, auth, updatedAt: now,
          } : request),
        };
      }

      const newId = uid();
      return {
        ...collection,
        updatedAt: now,
        requests: [
          { id: newId, name, folderId: saveModalFolderId || undefined, method, url, headers, queryParams: queryRows, body, auth, createdAt: now, updatedAt: now },
          ...collection.requests,
        ],
      };
    }));

    const savedId = saveModalSelectedRequestId || activeSavedRequestId;
    const snapshot = { ...currentSnapshot(), requestName: name, activeSavedRequestId: savedId };
    setRequestName(name);
    setActiveSavedRequestId(savedId);
    setTabs((items) => items.map((tab) => tab.id === activeTabId ? { ...tab, title: tabTitle(snapshot), dirty: false, snapshot } : tab));
    setShowSaveModal(false);
  }

  function loadSavedRequest(collectionId: string, requestId: string, openInNewTab = false) {
    const saved = collections.find((collection) => collection.id === collectionId)?.requests.find((request) => request.id === requestId);
    if (!saved) return;
    const snapshot: RequestSnapshot = {
      method: saved.method,
      url: saved.url,
      headers: saved.headers,
      queryRows: Array.isArray(saved.queryParams) ? saved.queryParams : [],
      body: saved.body,
      bodyType: 'raw',
      bodyRows: defaultBodyRows(),
      auth: saved.auth ?? defaultAuth(),
      requestName: saved.name,
      activeSavedRequestId: saved.id,
      selectedCollectionId: collectionId,
      response: null,
      error: '',
    };
    if (openInNewTab) {
      newTab(snapshot, false, `saved:${collectionId}:${requestId}`);
      return;
    }
    applySnapshot(snapshot);
    setTabs((items) => items.map((tab) => tab.id === activeTabId ? { ...tab, title: tabTitle(snapshot), dirty: false, snapshot } : tab));
  }

  function deleteSavedRequest(collectionId: string, requestId: string) {
    setCollections((items) => items.map((collection) => {
      if (collection.id !== collectionId) return collection;
      return { ...collection, updatedAt: new Date().toISOString(), requests: collection.requests.filter((request) => request.id !== requestId) };
    }));
    if (activeSavedRequestId === requestId) {
      setActiveSavedRequestId('');
    }
  }

  function duplicateSavedRequest(collectionId: string, requestId: string) {
    setCollections((items) => items.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const original = collection.requests.find((request) => request.id === requestId);
      if (!original) return collection;
      return { ...collection, updatedAt: new Date().toISOString(), requests: [{ ...original, id: uid(), name: `${original.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...collection.requests] };
    }));
  }

  function startRename(requestId: string, currentName: string) {
    setRenamingRequestId(requestId);
    setRenameValue(currentName);
  }

  function commitRename(collectionId: string) {
    if (!renameValue.trim()) {
      setRenamingRequestId('');
      return;
    }
    setCollections((items) => items.map((collection) => {
      if (collection.id !== collectionId) return collection;
      return { ...collection, updatedAt: new Date().toISOString(), requests: collection.requests.map((request) => request.id === renamingRequestId ? { ...request, name: renameValue.trim(), updatedAt: new Date().toISOString() } : request) };
    }));
    setRenamingRequestId('');
  }

  async function copyResponseBody() {
    if (!response) return;
    await navigator.clipboard.writeText(response.body);
    setToastMessage('Response body copied.');
    window.setTimeout(() => setToastMessage(''), 2200);
  }

  function shellQuote(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  function getRequestBodyForExport() {
    if (!canHaveBody) return '';
    if (bodyType === 'raw') return body;
    const rows = bodyRows.filter((row) => row.enabled && row.key.trim());
    return new URLSearchParams(rows.map((row) => [row.key, row.value])).toString();
  }

  function generateCurlSnippet() {
    const lines = [`curl ${shellQuote(effectiveUrl)}`];

    if (method !== 'GET') {
      lines.push(`  -X ${method}`);
    }

    Object.entries(requestHeaders).forEach(([key, value]) => {
      lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
    });

    if (bodyType === 'form-data' && canHaveBody) {
      bodyRows.filter((row) => row.enabled && row.key.trim()).forEach((row) => {
        const value = row.fieldType === 'file' ? `@${row.value}` : row.value;
        lines.push(`  -F ${shellQuote(`${row.key.trim()}=${value}`)}`);
      });
    } else {
      const exportBody = getRequestBodyForExport();
      if (exportBody) lines.push(`  --data-raw ${shellQuote(exportBody)}`);
    }

    return lines.join(' \\\n');
  }

  function generateFetchSnippet() {
    const headersJson = JSON.stringify(requestHeaders, null, 2);
    const bodyText = getRequestBodyForExport();
    const lines = [`const response = await fetch(${JSON.stringify(effectiveUrl)}, {`, `  method: ${JSON.stringify(method)},`];
    if (Object.keys(requestHeaders).length > 0) lines.push(`  headers: ${headersJson.replace(/\n/g, '\n  ')},`);
    if (canHaveBody && bodyText) lines.push(`  body: ${JSON.stringify(bodyText)},`);
    lines.push('});', '', 'const data = await response.text();', 'console.log(data);');
    return lines.join('\n');
  }

  function generateAxiosSnippet() {
    const bodyText = getRequestBodyForExport();
    const config = [`method: ${JSON.stringify(method.toLowerCase())}`, `url: ${JSON.stringify(effectiveUrl)}`];
    if (Object.keys(requestHeaders).length > 0) config.push(`headers: ${JSON.stringify(requestHeaders, null, 2).replace(/\n/g, '\n  ')}`);
    if (canHaveBody && bodyText) config.push(`data: ${JSON.stringify(bodyText)}`);
    return `import axios from 'axios';\n\nconst response = await axios({\n  ${config.join(',\n  ')}\n});\n\nconsole.log(response.data);`;
  }

  function generatePythonSnippet() {
    const bodyText = getRequestBodyForExport();
    const args = [`${JSON.stringify(method)}`, `${JSON.stringify(effectiveUrl)}`];
    if (Object.keys(requestHeaders).length > 0) args.push(`headers=${JSON.stringify(requestHeaders, null, 2)}`);
    if (canHaveBody && bodyText) args.push(`data=${JSON.stringify(bodyText)}`);
    return `import requests\n\nresponse = requests.request(${args.join(', ')})\n\nprint(response.text)`;
  }

  function generateSnippet() {
    if (snippetLanguage === 'fetch') return generateFetchSnippet();
    if (snippetLanguage === 'axios') return generateAxiosSnippet();
    if (snippetLanguage === 'python') return generatePythonSnippet();
    return generateCurlSnippet();
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(generateSnippet());
    setToastMessage('Code snippet copied.');
    window.setTimeout(() => setToastMessage(''), 2200);
  }

  function formatRequestBodyJson() {
    try {
      setBody(JSON.stringify(JSON.parse(body), null, 2));
      setError('');
    } catch {
      setError('Request body is not valid JSON.');
    }
  }

  function handleBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const pairs: Record<string, string> = {
      '"': '"',
      "'": "'",
      '{': '}',
      '[': ']',
      '(': ')',
    };
    const closingChars = new Set(Object.values(pairs));
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const close = pairs[event.key];

    if (close) {
      event.preventDefault();
      const selected = body.slice(start, end);
      const nextBody = `${body.slice(0, start)}${event.key}${selected}${close}${body.slice(end)}`;
      setBody(nextBody);
      requestAnimationFrame(() => {
        const cursor = selected ? end + 2 : start + 1;
        textarea.setSelectionRange(cursor, cursor);
      });
      return;
    }

    if (closingChars.has(event.key) && body[start] === event.key && start === end) {
      event.preventDefault();
      requestAnimationFrame(() => textarea.setSelectionRange(start + 1, start + 1));
      return;
    }

    if (event.key === 'Backspace' && start === end) {
      const previous = body[start - 1];
      const next = body[start];
      if (previous && pairs[previous] === next) {
        event.preventDefault();
        setBody(`${body.slice(0, start - 1)}${body.slice(start + 1)}`);
        requestAnimationFrame(() => textarea.setSelectionRange(start - 1, start - 1));
      }
    }
  }

  function handleImportCollection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { collection, requestCount } = importPostmanCollection(reader.result as string);
        setCollections((prev) => [...prev, collection]);
        setSelectedCollectionId(collection.id);
        setToastMessage(`Imported "${collection.name}" (${requestCount} requests)`);
      } catch (err) {
        setToastMessage(err instanceof Error ? err.message : 'Failed to import collection.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  async function handleExportCollection(collection: Collection) {
    const json = exportAsPostmanCollection(collection);
    const defaultName = `${collection.name.replace(/[^a-zA-Z0-9]/g, '_')}.postman_collection.json`;

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Postman Collection', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, json);
        setToastMessage(`Exported to ${filePath}`);
      }
    } catch {
      // Fallback: browser download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = defaultName;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  }

  function moveRequest(collectionId: string, requestId: string, folderId?: string) {
    const now = new Date().toISOString();
    setCollections((items) => items.map((collection) => collection.id === collectionId ? {
      ...collection,
      updatedAt: now,
      requests: collection.requests.map((request) => request.id === requestId ? { ...request, folderId, updatedAt: now } : request),
    } : collection));
  }

  function moveFolder(collectionId: string, folderId: string, parentId?: string) {
    if (folderId === parentId) return;
    const collection = collections.find((item) => item.id === collectionId);
    const folders = collection?.folders ?? [];
    let nextParent = parentId;
    while (nextParent) {
      if (nextParent === folderId) return;
      nextParent = folders.find((folder) => folder.id === nextParent)?.parentId;
    }
    const now = new Date().toISOString();
    setCollections((items) => items.map((item) => item.id === collectionId ? {
      ...item,
      updatedAt: now,
      folders: (item.folders ?? []).map((folder) => folder.id === folderId ? { ...folder, parentId, updatedAt: now } : folder),
    } : item));
  }

  const [activeTreeDrag, setActiveTreeDrag] = useState<TreeDragData | null>(null);
  const treeSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleTreeDragEnd(event: DragEndEvent) {
    const dragged = event.active.data.current as TreeDragData | undefined;
    const target = event.over?.data.current as TreeDropData | undefined;
    setActiveTreeDrag(null);
    if (!dragged || !target || dragged.collectionId !== target.collectionId) return;
    const targetFolderId = target.type === 'folder' ? target.folderId : undefined;
    if (dragged.type === 'request') moveRequest(target.collectionId, dragged.id, targetFolderId);
    if (dragged.type === 'folder') moveFolder(target.collectionId, dragged.id, targetFolderId);
  }

  function renderSavedRequest(collection: Collection, saved: Collection['requests'][number]) {
    return (
      <div className="saved-request" key={saved.id}>
        {renamingRequestId === saved.id ? (
          <div className="rename-row">
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') commitRename(collection.id); if (e.key === 'Escape') setRenamingRequestId(''); }} />
            <button onClick={() => commitRename(collection.id)} title="Confirm rename">✓</button>
            <button onClick={() => setRenamingRequestId('')} title="Cancel rename">×</button>
          </div>
        ) : (
          <DraggableTreeButton
            payload={{ type: 'request', collectionId: collection.id, id: saved.id }}
            className={activeSavedRequestId === saved.id ? 'active' : ''}
            onClick={() => loadSavedRequest(collection.id, saved.id, true)}
            title="Open request / drag to move"
          >
            <strong className={methodColorClass(saved.method)}>{saved.method}</strong>
            <span>{saved.name}</span>
          </DraggableTreeButton>
        )}
        <div className="saved-request-menu">
          <button className="menu-trigger" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenuState(menuState?.requestId === saved.id ? null : { requestId: saved.id, collectionId: collection.id, rect, name: saved.name }); }} title="More actions"><span aria-hidden="true">•••</span></button>
        </div>
      </div>
    );
  }

  function handleUrlPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text/plain').trim();
    if (!text.toLowerCase().startsWith('curl ')) return;
    
    event.preventDefault();
    try {
      const parsed = parseCurl(text);
      setMethod(parsed.method);
      setUrlPreservingQuery(parsed.url);
      setHeaders(parsed.headers);
      setBody(parsed.body);
      setBodyType('raw');
      setToastMessage('Imported cURL from clipboard.');
      window.setTimeout(() => setToastMessage(''), 2200);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Could not parse cURL.');
      window.setTimeout(() => setToastMessage(''), 2800);
    }
  }

  function importCurl() {
    try {
      const parsed = parseCurl(curlInput);
      setMethod(parsed.method);
      setUrlPreservingQuery(parsed.url);
      setHeaders(parsed.headers);
      setBody(parsed.body);
      setBodyType('raw');
      setBodyRows(defaultBodyRows());
      setAuth(defaultAuth());
      setResponse(null);
      setError('');
      setRequestName('');
      setActiveSavedRequestId('');
      setImportMessage('cURL imported successfully.');
      setCurlInput('');
      setShowImportModal(false);
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Failed to import cURL.');
    }
  }

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region>
          <button className="sidebar-toggle-btn" onClick={toggleSidebar} title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}>
            {sidebarVisible ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none">
                <rect x="2" y="3" width="3" height="18" rx="1.5" fill="currentColor" opacity=".45"/>
                <rect x="7" y="3" width="15" height="8" rx="2" fill="currentColor" opacity=".85"/>
                <rect x="7" y="13" width="15" height="8" rx="2" fill="currentColor" opacity=".85"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none">
                <rect x="2" y="3" width="7" height="18" rx="2" fill="currentColor" opacity=".85"/>
                <rect x="11" y="3" width="11" height="8" rx="2" fill="currentColor" opacity=".85"/>
                <rect x="11" y="13" width="11" height="8" rx="2" fill="currentColor" opacity=".85"/>
              </svg>
            )}
          </button>
          <span className="app-dot" />
          <strong data-tauri-drag-region>Arcus</strong>
        </div>
        <div className="window-controls">
          <button onClick={minimizeWindow} aria-label="Minimize window" title="Minimize window">−</button>
          <button onClick={toggleMaximizeWindow} aria-label="Maximize window" title="Maximize window">□</button>
          <button className="close-window" onClick={closeWindow} aria-label="Close window" title="Close window">×</button>
        </div>
      </header>
      <div className="shell">
      <aside className={`sidebar${sidebarVisible ? '' : ' sidebar-collapsed'}`}>
        <div className="brand">Arcus</div>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportCollection} style={{ display: 'none' }} />
        <div className="collections-header">
          <h3>Collections</h3>
          <div className="collections-actions">
            <button onClick={() => fileInputRef.current?.click()} title="Import collection" aria-label="Import collection">
              <img src={importCollectionIcon} alt="" aria-hidden="true" />
            </button>
            <button onClick={() => openCollectionModal()} title="New collection">+</button>
          </div>
        </div>
        {collections.length > 0 && (
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search collections..." className="search-input" autoComplete="off" />
        )}
        {collections.length === 0 && <p className="muted">No collections yet.</p>}
        {collections.length > 0 && filteredCollections.length === 0 && <p className="muted small">No matching results.</p>}
        <DndContext sensors={treeSensors} collisionDetection={pointerWithin} onDragStart={(event) => setActiveTreeDrag(event.active.data.current as TreeDragData)} onDragCancel={() => setActiveTreeDrag(null)} onDragEnd={handleTreeDragEnd}>
        <div className="collection-list">
          {filteredCollections.map((collection) => (
            <details className="collection-item" key={collection.id} open={selectedCollectionId === collection.id} onToggle={(event) => { if (event.currentTarget.open) setSelectedCollectionId(collection.id); }}>
              <summary>
                <TreeDropZone drop={{ type: 'root', collectionId: collection.id }} className="collection-root-drop"><span>{collection.name}</span></TreeDropZone>
                <small>{collection.requests.length}</small>
                <button className="menu-trigger" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setCollectionMenuState(collectionMenuState?.collectionId === collection.id ? null : { collectionId: collection.id, rect, name: collection.name }); }} title="Collection actions"><span aria-hidden="true">•••</span></button>
              </summary>
              <TreeDropZone drop={{ type: 'root', collectionId: collection.id }} className="saved-request-list root-request-drop">
                {orderedFoldersForTree(collection.folders ?? []).map((folder) => {
                  const folderRequests = collection.requests.filter((saved) => saved.folderId === folder.id);
                  const depth = (() => {
                    let level = 0;
                    let parentId = folder.parentId;
                    const seen = new Set([folder.id]);
                    while (parentId && !seen.has(parentId)) {
                      const parent = (collection.folders ?? []).find((item) => item.id === parentId);
                      if (!parent) break;
                      level += 1;
                      seen.add(parent.id);
                      parentId = parent.parentId;
                    }
                    return level;
                  })();
                  return (
                    <TreeDropZone key={folder.id} drop={{ type: 'folder', collectionId: collection.id, folderId: folder.id }} className="folder-drop-wrap">
                      <details
                        className="folder-item"
                        open
                        style={{ marginLeft: depth ? Math.min(depth * 10, 30) : 0 }}
                      >
                        <summary>
                          <DraggableTreeButton className="folder-drag-button" payload={{ type: 'folder', collectionId: collection.id, id: folder.id }} title="Drag folder to move">
                            <span className="folder-name"><span className="folder-icon" aria-hidden="true" />{folder.name}</span>
                            <small>{folderRequests.length}</small>
                          </DraggableTreeButton>
                          <button className="menu-trigger" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setFolderMenuState(folderMenuState?.folderId === folder.id ? null : { collectionId: collection.id, folderId: folder.id, rect, name: folder.name }); }} title="Folder actions"><span aria-hidden="true">•••</span></button>
                        </summary>
                        <div className="folder-requests">
                          {folderRequests.map((saved) => renderSavedRequest(collection, saved))}
                          {folderRequests.length === 0 && <p className="muted small">No requests in this folder.</p>}
                        </div>
                      </details>
                    </TreeDropZone>
                  );
                })}
                {collection.requests.filter((saved) => !saved.folderId).map((saved) => renderSavedRequest(collection, saved))}
                {collection.requests.length === 0 && <p className="muted small">No saved requests.</p>}
              </TreeDropZone>
            </details>
          ))}
        </div>
          <DragOverlay>{activeTreeDrag ? <div className="tree-drag-overlay">{activeTreeDrag.type === 'folder' ? 'Folder' : 'Request'}</div> : null}</DragOverlay>
        </DndContext>

        <div className="collections-header" style={{ marginTop: 28 }}>
          <h3>Environment</h3>
          <button onClick={() => openEnvEditor()} title="New environment">+</button>
        </div>
        {environments.length > 0 && (
          <div className="env-list">
            {environments.map((env) => (
              <span
                key={env.id}
                className={`env-chip ${env.id === activeEnvironmentId ? 'env-chip-active' : ''}`}
                onClick={() => setActiveEnvironmentId(env.id === activeEnvironmentId ? '' : env.id)}
              >
                {env.name}
                <button className="env-edit-btn" onClick={(e) => { e.stopPropagation(); openEnvEditor(env); }} title="Edit environment">✎</button>
              </span>
            ))}
          </div>
        )}
        {environments.length === 0 && <p className="muted small">No environments. Create one to use variables.</p>}

        <div className="history-header">
          <h3>History</h3>
          {history.length > 0 && <button className="clear-history" onClick={() => setShowClearHistoryModal(true)} title="Clear history">Clear</button>}
        </div>
        <div className="history-list">
          {history.length === 0 && <p className="muted">No requests yet.</p>}
          {history.map((item) => (
            <button className="history-item" key={item.id} onClick={() => newTab(item.snapshot, false, `history:${item.id}`)} title="Open from history">
              <strong className={item.method ? methodColorClass(item.method) : ''}>{item.method}</strong>
              <span>{item.url}</span>
              <small><span className={item.status ? statusBadgeClass(item.status) : 'status-err'}>{item.status ?? 'err'}</span> · {item.status ? `${item.durationMs}ms` : 'failed'} · {item.createdAt}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <div className="request-tabs">
          {tabs.map((tab) => (
            <button key={tab.id} className={`request-tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)} onContextMenu={(e) => openTabMenu(e, tab.id)} title="Open tab / right-click for options">
              <span>{tab.dirty ? '• ' : ''}{tab.title}</span>
              <button className="request-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} title="Close tab">×</button>
            </button>
          ))}
          <button className="request-tab-add" onClick={() => newTab()} title="New tab">+</button>
        </div>
        {tabMenu && (
          <div className="tab-context-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onMouseLeave={() => setTabMenu(null)}>
            <button onClick={() => { closeTab(tabMenu.tabId); setTabMenu(null); }} title="Close selected tab">Close this tab</button>
            <button onClick={() => closeOtherTabs(tabMenu.tabId)} disabled={tabs.length <= 1} title="Close every tab except this one">Close other tabs</button>
            <button onClick={closeAllTabs} title="Close all tabs and open a blank one">Close all tabs</button>
          </div>
        )}
        <div className="request-bar">
          <button className="import-curl-inline-button" onClick={() => { setShowImportModal(true); setCurlInput(''); setImportMessage(''); }} title="Import cURL" aria-label="Import cURL">
            <img src={curlIcon} alt="" aria-hidden="true" />
          </button>
          <Dropdown
            value={method}
            onChange={(v) => setMethod(v as HttpMethod)}
            options={methods.map((m) => ({ value: m, label: m }))}
          />
          <input value={url} onChange={(e) => setUrlPreservingQuery(e.target.value)} onPaste={handleUrlPaste} placeholder="Enter request URL" />
          <button onClick={sendRequest} disabled={loading || !url.trim()} title="Send request">{loading ? 'Sending...' : 'Send'}</button>
          <button onClick={openSaveModal} disabled={!url.trim()} className="save-request-button" title="Save request to collection" aria-label="Save request to collection">
            <img src={saveIcon} alt="" aria-hidden="true" />
          </button>
          <button onClick={() => setShowSnippetModal(true)} disabled={!url.trim()} className="snippet-button" title="Generate code snippet" aria-label="Generate code snippet">
            <img src={codeSquareIcon} alt="" aria-hidden="true" />
          </button>
        </div>
        <div className="panels">
          <section className="card request-card">
            <h2>Request</h2>
            <div className="section-title">
              Query Params
              <button className="bulk-edit-toggle" onClick={toggleBulkQuery} title="Switch query params editor mode">
                {bulkEditQuery ? 'Key-Value' : 'Bulk Edit'}
              </button>
            </div>
            {bulkEditQuery ? (
              <div className="bulk-headers-editor">
                <div className="bulk-line-numbers" ref={(el) => { if (el) el.scrollTop = el.parentElement?.querySelector('textarea')?.scrollTop ?? 0; }}>{bulkQueryRaw.split('\n').map((_, i) => <span key={i}>{i + 1}</span>)}</div>
                <textarea
                  className="bulk-headers-input"
                  value={bulkQueryRaw}
                  onKeyDown={handleBulkQueryKeyDown}
                  onScroll={(e) => { (e.currentTarget.previousElementSibling as HTMLElement).scrollTop = e.currentTarget.scrollTop; }}
                  onChange={(e) => handleBulkQueryChange(e.target.value)}
                  placeholder="page: 1&#10;limit: 20"
                />
              </div>
            ) : (
              <>
                <div className="headers-table spreadsheet-table">
                  <div className="spreadsheet-head">
                    <span />
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {queryRows.map((row) => (
                    <div className="header-row spreadsheet-row" key={row.id}>
                      <label className="sheet-check"><input type="checkbox" checked={row.enabled} onChange={(e) => updateQueryRow(row.id, { enabled: e.target.checked })} /></label>
                      <input value={row.key} onChange={(e) => updateQueryRow(row.id, { key: e.target.value })} placeholder="Param" />
                      <input value={row.value} onChange={(e) => updateQueryRow(row.id, { value: e.target.value })} placeholder="Value" />
                      <button className="ghost" onClick={() => deleteQueryRow(row.id)} title="Remove param">×</button>
                    </div>
                  ))}
                </div>
                <button className="link-button" onClick={() => { const next = [...queryRows, { id: uid(), key: '', value: '', enabled: true }]; setUrlFromQueryRows(next); }} title="Add query param">+ Add param</button>
              </>
            )}

            <div className="section-title">
              Headers
              <button className="bulk-edit-toggle" onClick={toggleBulkHeaders} title="Switch headers editor mode">
                {bulkEditHeaders ? 'Key-Value' : 'Bulk Edit'}
              </button>
            </div>
            {bulkEditHeaders ? (
              <div className="bulk-headers-editor">
                <div className="bulk-line-numbers" ref={(el) => { if (el) el.scrollTop = el.parentElement?.querySelector('textarea')?.scrollTop ?? 0; }}>{bulkHeadersRaw.split('\n').map((_, i) => <span key={i}>{i + 1}</span>)}</div>
                <textarea
                  className="bulk-headers-input"
                  value={bulkHeadersRaw}
                  onKeyDown={handleBulkHeadersKeyDown}
                  onScroll={(e) => { (e.currentTarget.previousElementSibling as HTMLElement).scrollTop = e.currentTarget.scrollTop; }}
                  onChange={(e) => handleBulkHeadersChange(e.target.value)}
                  placeholder="Content-Type: application/json&#10;Authorization: Bearer token"
                />
              </div>
            ) : (
              <>
                <div className="headers-table spreadsheet-table">
                  <div className="spreadsheet-head">
                    <span />
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {headers.map((row) => (
                    <div className="header-row spreadsheet-row" key={row.id}>
                      <label className="sheet-check"><input type="checkbox" checked={row.enabled} onChange={(e) => updateHeader(row.id, { enabled: e.target.checked })} /></label>
                      <input value={row.key} onChange={(e) => updateHeader(row.id, { key: e.target.value })} placeholder="Header" />
                      <input value={row.value} onChange={(e) => updateHeader(row.id, { value: e.target.value })} placeholder="Value" />
                      <button className="ghost" onClick={() => setHeaders((rows) => rows.filter((item) => item.id !== row.id))} title="Remove header">×</button>
                    </div>
                  ))}
                </div>
                <button className="link-button" onClick={() => setHeaders((rows) => [...rows, { id: uid(), key: '', value: '', enabled: true }])} title="Add header">+ Add header</button>
              </>
            )}

            <div className="auth-section">
              <div className="auth-header">
                <div className="section-title">Auth</div>
                <Dropdown
                  value={auth.type}
                  onChange={(v) => setAuth({ ...auth, type: v as AuthType })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'bearer', label: 'Bearer Token' },
                    { value: 'basic', label: 'Basic Auth' },
                    { value: 'apikey', label: 'API Key' },
                  ]}
                />
              </div>
              {auth.type === 'bearer' && (
                <input
                  value={auth.bearerToken}
                  onChange={(event) => setAuth({ ...auth, bearerToken: event.target.value })}
                  placeholder="Paste Bearer token..."
                  className="auth-input"
                  autoComplete="off"
                />
              )}
              {auth.type === 'basic' && (
                <div className="auth-fields">
                  <input
                    value={auth.basicUsername}
                    onChange={(event) => setAuth({ ...auth, basicUsername: event.target.value })}
                    placeholder="Username"
                    autoComplete="off"
                  />
                  <input
                    value={auth.basicPassword}
                    onChange={(event) => setAuth({ ...auth, basicPassword: event.target.value })}
                    placeholder="Password"
                    type="password"
                    autoComplete="off"
                  />
                </div>
              )}
              {auth.type === 'apikey' && (
                <>
                  <div className="auth-fields">
                    <input
                      value={auth.apiKey}
                      onChange={(event) => setAuth({ ...auth, apiKey: event.target.value })}
                      placeholder="Key name"
                      autoComplete="off"
                    />
                    <input
                      value={auth.apiValue}
                      onChange={(event) => setAuth({ ...auth, apiValue: event.target.value })}
                      placeholder="Key value"
                      autoComplete="off"
                    />
                  </div>
                  <div className="auth-apikey-location">
                    <label>Send via:</label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="apikey-location"
                        value="header"
                        checked={auth.apiIn === 'header'}
                        onChange={() => setAuth({ ...auth, apiIn: 'header' })}
                      />
                      Header
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="apikey-location"
                        value="query"
                        checked={auth.apiIn === 'query'}
                        onChange={() => setAuth({ ...auth, apiIn: 'query' })}
                      />
                      Query Param
                    </label>
                  </div>
                </>
              )}
            </div>

            <div className="body-header">
              <div className="section-title">Body</div>
              <div className="body-actions">
                <Dropdown
                  value={bodyType}
                  onChange={(v) => setBodyType(v as BodyType)}
                  options={[
                    { value: 'raw', label: 'raw' },
                    { value: 'form-data', label: 'form-data' },
                    { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
                  ]}
                  disabled={!canHaveBody}
                />
                {bodyType === 'raw' && <button className="format-button" onClick={formatRequestBodyJson} disabled={!canHaveBody || !body.trim()} title="Format body as JSON">Format JSON</button>}
              </div>
            </div>
            {bodyType === 'raw' ? (
              <textarea disabled={!canHaveBody} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={handleBodyKeyDown} onBlur={() => { if (body.trim()) formatRequestBodyJson(); }} placeholder={canHaveBody ? '{\n  "hello": "world"\n}' : 'Body disabled for this method'} />
            ) : (
              <div className="body-table">
                {bodyRows.map((row) => (
                  <div className="body-row" key={row.id}>
                    <input type="checkbox" checked={row.enabled} onChange={(e) => updateBodyRow(row.id, { enabled: e.target.checked })} disabled={!canHaveBody} />
                    {bodyType === 'form-data' && (
                      <Dropdown
                        value={row.fieldType}
                        onChange={(v) => updateBodyRow(row.id, { fieldType: v as 'text' | 'file', value: '' })}
                        options={[{ value: 'text', label: 'Text' }, { value: 'file', label: 'File' }]}
                        disabled={!canHaveBody}
                      />
                    )}
                    <input value={row.key} onChange={(e) => updateBodyRow(row.id, { key: e.target.value })} placeholder="Key" disabled={!canHaveBody} />
                    {row.fieldType === 'file' && bodyType === 'form-data' ? (
                      <div className="file-picker-row">
                        <input value={row.value} onChange={(e) => updateBodyRow(row.id, { value: e.target.value })} placeholder="File path..." disabled={!canHaveBody} />
                        <button className="file-pick-btn" onClick={async () => {
                          try {
                            const { open } = await import('@tauri-apps/plugin-dialog');
                            const selected = await open({ multiple: false });
                            if (selected) updateBodyRow(row.id, { value: selected as string });
                          } catch {
                            // Fallback: manual path input
                          }
                        }} disabled={!canHaveBody} title="Browse file">📁</button>
                      </div>
                    ) : (
                      <input value={row.value} onChange={(e) => updateBodyRow(row.id, { value: e.target.value })} placeholder={bodyType === 'form-data' ? 'Value' : 'Value'} disabled={!canHaveBody} />
                    )}
                    <button className="ghost" onClick={() => setBodyRows((rows) => rows.filter((item) => item.id !== row.id))} disabled={!canHaveBody} title="Remove form field">×</button>
                  </div>
                ))}
                <button className="link-button" onClick={() => setBodyRows((rows) => [...rows, { id: uid(), key: '', value: '', enabled: true, fieldType: 'text' }])} disabled={!canHaveBody} title="Add form-data field">+ Add field</button>
              </div>
            )}
          </section>

          <section className="card response-card">
            <h2>Response</h2>
            {error && <div className="error">{error}</div>}
            {!response && !error && <p className="muted">Send a request to view response.</p>}
            {response && (
              <>
                <div className="response-meta">
                  <span className={statusBadgeClass(response.status)}>{response.status} {response.statusText}</span>
                  <span>{response.durationMs}ms total</span>
                  <span>{Object.keys(response.headers).length} headers</span>
                </div>
                <button className="timing-toggle" onClick={() => setShowTimingBreakdown((value) => !value)} title="Show or hide timing breakdown">
                  <span>{showTimingBreakdown ? '−' : '+'}</span>
                  Timing breakdown
                </button>
                {showTimingBreakdown && (
                  <div className="timing-breakdown">
                    <div><span>Total</span><strong>{response.timings.totalMs}ms</strong></div>
                    <div><span>Request + TTFB</span><strong>{response.timings.firstByteMs}ms</strong></div>
                    <div><span>Upload</span><strong>{response.timings.uploadMs}ms</strong></div>
                    <div><span>Download</span><strong>{response.timings.downloadMs}ms</strong></div>
                    <div><span>Body Read</span><strong>{response.timings.bodyReadMs}ms</strong></div>
                  </div>
                )}
                <div className="response-body-header">
                  <div className="section-title">{responseView === 'headers' ? 'Response Headers' : 'Response Body'}</div>
                  <button className="copy-body-button" onClick={copyResponseBody} title="Copy response body">Copy</button>
                  <div className="view-tabs" role="tablist" aria-label="Response view mode">
                    <button className={responseView === 'preview' ? 'active' : ''} onClick={() => setResponseView('preview')} role="tab" aria-selected={responseView === 'preview'} title="Show formatted response preview">Preview</button>
                    <button className={responseView === 'raw' ? 'active' : ''} onClick={() => setResponseView('raw')} role="tab" aria-selected={responseView === 'raw'} title="Show raw response body">Raw</button>
                    <button className={responseView === 'headers' ? 'active' : ''} onClick={() => setResponseView('headers')} role="tab" aria-selected={responseView === 'headers'} title="Show response headers">Headers</button>
                  </div>
                </div>
                {responseView === 'headers' ? (
                  <div className="response-headers-table">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div className="response-header-row" key={key}>
                        <span className="response-header-key">{key}</span>
                        <span className="response-header-value">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : responseView === 'preview' && response.bodyBase64 && getContentType(response.headers).toLowerCase().startsWith('image/') ? (
                  <div className="image-preview-wrap">
                    <img src={`data:${getContentType(response.headers).split(';')[0]};base64,${response.bodyBase64}`} alt="Response preview" />
                  </div>
                ) : responseView === 'preview' && responseJson !== null ? <JsonTree data={responseJson} /> : <pre>{response.body}</pre>}
              </>
            )}
          </section>
        </div>
      </section>
      </div>

      {toastMessage && <div className="toast-message" role="status" aria-live="polite">{toastMessage}</div>}

      {collectionMenuState && (
        <>
          <div className="menu-backdrop" onClick={() => setCollectionMenuState(null)} />
          <div className="menu-dropdown" style={{ position: 'fixed', top: collectionMenuState.rect.bottom + 4, right: window.innerWidth - collectionMenuState.rect.right, zIndex: 100 }}>
            <button onClick={() => { const collection = collections.find((item) => item.id === collectionMenuState.collectionId); if (collection) openCollectionModal(collection); setCollectionMenuState(null); }} title="Rename collection">✎ Rename</button>
            <button onClick={() => { openFolderModal(collectionMenuState.collectionId); setCollectionMenuState(null); }} title="Add folder to collection">+ Add folder</button>
            <button onClick={() => { const collection = collections.find((item) => item.id === collectionMenuState.collectionId); if (collection) handleExportCollection(collection); setCollectionMenuState(null); }} title="Export as Postman collection">↗ Export</button>
            <button className="menu-danger" onClick={() => { openDeleteCollectionModal(collectionMenuState.collectionId); setCollectionMenuState(null); }} title="Delete collection">× Delete</button>
          </div>
        </>
      )}

      {folderMenuState && (
        <>
          <div className="menu-backdrop" onClick={() => setFolderMenuState(null)} />
          <div className="menu-dropdown" style={{ position: 'fixed', top: folderMenuState.rect.bottom + 4, right: window.innerWidth - folderMenuState.rect.right, zIndex: 100 }}>
            <button onClick={() => { openFolderModal(folderMenuState.collectionId, undefined, folderMenuState.folderId); setFolderMenuState(null); }} title="Add subfolder">+ Add subfolder</button>
            <button onClick={() => {
              const collection = collections.find((item) => item.id === folderMenuState.collectionId);
              const folder = collection?.folders?.find((item) => item.id === folderMenuState.folderId);
              if (folder) openFolderModal(folderMenuState.collectionId, folder);
              setFolderMenuState(null);
            }} title="Rename folder">✎ Rename</button>
            <button className="menu-danger" onClick={() => {
              const collection = collections.find((item) => item.id === folderMenuState.collectionId);
              const folder = collection?.folders?.find((item) => item.id === folderMenuState.folderId);
              if (folder) openDeleteFolderModal(folderMenuState.collectionId, folder);
              setFolderMenuState(null);
            }} title="Delete folder">× Delete</button>
          </div>
        </>
      )}

      {menuState && (
        <>
          <div className="menu-backdrop" onClick={() => setMenuState(null)} />
          <div className="menu-dropdown" style={{ position: 'fixed', top: menuState.rect.bottom + 4, right: window.innerWidth - menuState.rect.right, zIndex: 100 }}>
            <button onClick={() => { duplicateSavedRequest(menuState.collectionId, menuState.requestId); setMenuState(null); }} title="Duplicate saved request">⧉ Duplicate</button>
            <button onClick={() => { startRename(menuState.requestId, menuState.name); setMenuState(null); }} title="Rename saved request">✎ Rename</button>
            <button className="menu-danger" onClick={() => { setDeleteTargetRequest({ collectionId: menuState.collectionId, requestId: menuState.requestId, name: menuState.name }); setMenuState(null); }} title="Delete saved request">× Delete</button>
          </div>
        </>
      )}

      {showSnippetModal && (
        <div className="modal-backdrop" onClick={() => setShowSnippetModal(false)}>
          <section className="modal-card snippet-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="snippet-title">
            <div className="import-header">
              <div>
                <h2 id="snippet-title">Code Snippet</h2>
                <p>Generate this request in another client or programming language.</p>
              </div>
              <button className="close-button" onClick={() => setShowSnippetModal(false)} aria-label="Close code snippet modal">×</button>
            </div>
            <div className="snippet-toolbar">
              <Dropdown
                value={snippetLanguage}
                onChange={(value) => setSnippetLanguage(value as typeof snippetLanguage)}
                options={[
                  { value: 'curl', label: 'cURL' },
                  { value: 'fetch', label: 'JavaScript fetch' },
                  { value: 'axios', label: 'Node.js axios' },
                  { value: 'python', label: 'Python requests' },
                ]}
              />
              <button className="copy-body-button" onClick={copySnippet} title="Copy generated code">Copy</button>
            </div>
            <pre className="snippet-preview" dangerouslySetInnerHTML={{ __html: highlightSnippet(generateSnippet()) }} />
          </section>
        </div>
      )}

      {showCollectionModal && (
        <div className="modal-backdrop" onClick={() => { setShowCollectionModal(false); setEditingCollectionId(''); setNewCollectionName(''); }}>
          <section className="modal-card compact-modal add-collection-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-collection-title">
            <div className="import-header">
              <div>
                <h2 id="add-collection-title">{editingCollectionId ? 'Rename Collection' : 'Add Collection'}</h2>
                <p>{editingCollectionId ? 'Update the collection name.' : 'Create a folder to organize saved API requests.'}</p>
              </div>
              <button className="close-button" onClick={() => { setShowCollectionModal(false); setEditingCollectionId(''); setNewCollectionName(''); }} aria-label="Close add collection modal">×</button>
            </div>
            <input className="modal-input collection-name-input" value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCollection(); }} placeholder="Collection name" autoFocus />
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => { setNewCollectionName(''); setEditingCollectionId(''); setShowCollectionModal(false); }} title="Cancel">Cancel</button>
              <button className="secondary-button" onClick={saveCollection} disabled={!newCollectionName.trim()} title={editingCollectionId ? 'Rename collection' : 'Create collection'}>{editingCollectionId ? 'Rename' : 'Create'}</button>
            </div>
          </section>
        </div>
      )}

      {deleteTargetCollectionId && (
        <div className="modal-backdrop" onClick={() => setDeleteTargetCollectionId('')}>
          <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-collection-title">
            <div className="import-header">
              <div>
                <h2 id="delete-collection-title">Delete Collection</h2>
                <p>This will permanently delete the collection and all saved requests inside it.</p>
              </div>
              <button className="close-button" onClick={() => setDeleteTargetCollectionId('')} aria-label="Close delete collection modal">×</button>
            </div>
            <div className="delete-summary">
              <strong>{collections.find((collection) => collection.id === deleteTargetCollectionId)?.name}</strong>
              <span>{collections.find((collection) => collection.id === deleteTargetCollectionId)?.requests.length ?? 0} saved requests</span>
            </div>
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => setDeleteTargetCollectionId('')} title="Cancel">Cancel</button>
              <button className="danger-action" onClick={() => deleteCollection(deleteTargetCollectionId)} title="Delete collection">Delete</button>
            </div>
          </section>
        </div>
      )}

      {deleteTargetRequest && (
        <div className="modal-backdrop" onClick={() => setDeleteTargetRequest(null)}>
          <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-request-title">
            <div className="import-header">
              <div>
                <h2 id="delete-request-title">Delete Request</h2>
                <p>This will permanently delete the saved request.</p>
              </div>
              <button className="close-button" onClick={() => setDeleteTargetRequest(null)} aria-label="Close delete request modal">×</button>
            </div>
            <div className="delete-summary">
              <strong>{deleteTargetRequest.name}</strong>
            </div>
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => setDeleteTargetRequest(null)} title="Cancel">Cancel</button>
              <button className="danger-action" onClick={() => { deleteSavedRequest(deleteTargetRequest.collectionId, deleteTargetRequest.requestId); setDeleteTargetRequest(null); }} title="Delete request">Delete</button>
            </div>
          </section>
        </div>
      )}

      {folderModalCollectionId && (
        <div className="modal-backdrop" onClick={() => setFolderModalCollectionId('')}>
          <section className="modal-card compact-modal folder-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
            <div className="import-header">
              <div>
                <h2 id="folder-modal-title">{editingFolderId ? 'Rename Folder' : 'New Folder'}</h2>
                <p>Organize saved requests inside this collection.</p>
              </div>
              <button className="close-button" onClick={() => setFolderModalCollectionId('')} aria-label="Close folder modal">×</button>
            </div>
            <Dropdown
              className="folder-parent-picker"
              value={folderModalParentId}
              onChange={setFolderModalParentId}
              options={[
                { value: '', label: 'Collection root' },
                ...((collections.find((collection) => collection.id === folderModalCollectionId)?.folders ?? [])
                  .filter((folder) => folder.id !== editingFolderId)
                  .map((folder) => ({ value: folder.id, label: folderDisplayName(folder, collections.find((collection) => collection.id === folderModalCollectionId)?.folders ?? []) }))),
              ]}
            />
            <input className="modal-input folder-name-input" value={folderModalName} onChange={(event) => setFolderModalName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveFolder(); }} placeholder="Folder name" autoFocus />
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="ghost-action" onClick={() => setFolderModalCollectionId('')} title="Cancel">Cancel</button>
              <button className="secondary-button" onClick={saveFolder} disabled={!folderModalName.trim()} title={editingFolderId ? 'Rename folder' : 'Create folder'}>{editingFolderId ? 'Rename' : 'Create'}</button>
            </div>
          </section>
        </div>
      )}

      {deleteTargetFolder && (
        <div className="modal-backdrop" onClick={() => setDeleteTargetFolder(null)}>
          <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
            <div className="import-header">
              <div>
                <h2 id="delete-folder-title">Delete Folder</h2>
                <p>Requests inside this folder will be moved to the collection root.</p>
              </div>
              <button className="close-button" onClick={() => setDeleteTargetFolder(null)} aria-label="Close delete folder modal">×</button>
            </div>
            <div className="delete-summary">
              <strong>{deleteTargetFolder.name}</strong>
              <span>{deleteTargetFolder.requestCount} saved requests</span>
            </div>
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => setDeleteTargetFolder(null)} title="Cancel">Cancel</button>
              <button className="danger-action" onClick={deleteFolder} title="Delete folder">Delete Folder</button>
            </div>
          </section>
        </div>
      )}

      {showClearHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowClearHistoryModal(false)}>
          <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
            <div className="import-header">
              <div>
                <h2 id="clear-history-title">Clear History</h2>
                <p>This will permanently delete all {history.length} request history entries.</p>
              </div>
              <button className="close-button" onClick={() => setShowClearHistoryModal(false)} aria-label="Close clear history modal">×</button>
            </div>
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => setShowClearHistoryModal(false)} title="Cancel">Cancel</button>
              <button className="danger-action" onClick={() => { setHistory([]); setShowClearHistoryModal(false); }} title="Clear all history">Clear All</button>
            </div>
          </section>
        </div>
      )}

      {showSaveModal && (
        <div className="modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <section className="modal-card save-request-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
            <div className="import-header">
              <div>
                <h2 id="save-modal-title">Save Request</h2>
                <p>{saveModalSelectedRequestId ? 'Update existing request or type a new name to save as new.' : 'Select a collection and name your request.'}</p>
              </div>
              <button className="close-button" onClick={() => setShowSaveModal(false)} aria-label="Close save modal">×</button>
            </div>
            <div className="save-modal-selects">
              <Dropdown
                value={saveModalCollectionId}
                onChange={(id) => { setSaveModalCollectionId(id); setSaveModalFolderId(''); setSaveModalSelectedRequestId(''); }}
                options={[{ value: '', label: 'Select collection...' }, ...collections.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <Dropdown
                value={saveModalFolderId}
                onChange={(id) => { setSaveModalFolderId(id); setSaveModalSelectedRequestId(''); }}
                options={[{ value: '', label: 'No folder' }, ...saveModalFolders.map((folder) => ({ value: folder.id, label: folder.name }))]}
              />
            </div>
            {saveModalRequests.length > 0 && (
              <div className="save-modal-requests">
                {saveModalRequests.map((req) => (
                  <button
                    key={req.id}
                    className={`save-modal-request-item ${req.id === saveModalSelectedRequestId ? 'save-modal-request-selected' : ''}`}
                    onClick={() => { setSaveModalSelectedRequestId(req.id); setSaveModalNewName(req.name); }}
                    title="Select request to update"
                  >
                    <strong className={methodColorClass(req.method)}>{req.method}</strong>
                    <span>{req.name}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              className="modal-input save-request-name-input"
              value={saveModalNewName}
              onChange={(e) => { setSaveModalNewName(e.target.value); setSaveModalSelectedRequestId(''); }}
              placeholder="Request name"
              onKeyDown={(e) => { if (e.key === 'Enter') doSaveRequest(); }}
            />
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="ghost-action" onClick={() => setShowSaveModal(false)} title="Cancel">Cancel</button>
              <button className="secondary-button" onClick={doSaveRequest} disabled={!saveModalCollectionId || !saveModalNewName.trim()} title="Save request">
                {saveModalSelectedRequestId ? 'Update' : 'Save as New'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <section className="modal-card curl-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="import-curl-title">
            <div className="import-header">
              <div>
                <h2 id="import-curl-title">Import cURL</h2>
                <p>Paste cURL copied from Chrome DevTools or Firefox Network tab.</p>
              </div>
              <button className="close-button" onClick={() => setShowImportModal(false)} aria-label="Close import cURL modal">×</button>
            </div>
            <textarea className="curl-input" value={curlInput} onChange={(e) => setCurlInput(e.target.value)} placeholder={"curl 'https://api.example.com/users' \\\n  -H 'accept: application/json' \\\n  --data-raw '{\"name\":\"Urip\"}'"} autoFocus />
            {importMessage && <small className="import-message">{importMessage}</small>}
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => { setCurlInput(''); setImportMessage(''); }} title="Clear cURL input">Clear</button>
              <button className="secondary-button" onClick={importCurl} disabled={!curlInput.trim()} title="Import cURL into current request">Import</button>
            </div>
          </section>
        </div>
      )}

      {showEnvEditor && (
        <div className="modal-backdrop" onClick={() => setShowEnvEditor(false)}>
          <section className="modal-card env-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="env-editor-title">
            <div className="import-header">
              <div>
                <h2 id="env-editor-title">{editingEnvId ? 'Edit Environment' : 'New Environment'}</h2>
                <p>Define variables to use as {"{{name}}"} in URLs, headers, and body.</p>
              </div>
              <button className="close-button" onClick={() => setShowEnvEditor(false)} aria-label="Close environment editor">×</button>
            </div>
            <input className="modal-input env-name-input" value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="Environment name (e.g. Development, Production)" autoFocus />
            <div className="section-title env-vars-title">
              Variables
              <button className="bulk-edit-toggle" onClick={toggleBulkEnvVars} title="Switch environment variables editor mode">
                {bulkEditEnvVars ? 'Key-Value' : 'Bulk Edit'}
              </button>
            </div>
            {bulkEditEnvVars ? (
              <div className="bulk-headers-editor env-bulk-editor">
                <div className="bulk-line-numbers" ref={(el) => { if (el) el.scrollTop = el.parentElement?.querySelector('textarea')?.scrollTop ?? 0; }}>{bulkEnvVarsRaw.split('\n').map((_, i) => <span key={i}>{i + 1}</span>)}</div>
                <textarea
                  className="bulk-headers-input"
                  value={bulkEnvVarsRaw}
                  onKeyDown={handleBulkEnvVarsKeyDown}
                  onScroll={(e) => { (e.currentTarget.previousElementSibling as HTMLElement).scrollTop = e.currentTarget.scrollTop; }}
                  onChange={(e) => handleBulkEnvVarsChange(e.target.value)}
                  placeholder="API_URL: https://api.example.com&#10;TOKEN: secret"
                />
              </div>
            ) : (
              <>
                <div className="env-vars-table spreadsheet-table">
                  <div className="spreadsheet-head">
                    <span />
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {envVars.map((v, i) => (
                    <div className="header-row spreadsheet-row" key={i}>
                      <label className="sheet-check"><input type="checkbox" checked={v.enabled} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], enabled: e.target.checked }; setEnvVars(next); }} /></label>
                      <input value={v.key} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], key: e.target.value }; setEnvVars(next); }} placeholder="VAR_NAME" />
                      <input value={v.value} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], value: e.target.value }; setEnvVars(next); }} placeholder="value" />
                      <button className="ghost" onClick={() => setEnvVars((prev) => prev.filter((_, j) => j !== i))} title="Remove variable">×</button>
                    </div>
                  ))}
                </div>
                <button className="link-button" onClick={() => setEnvVars((prev) => [...prev, { key: '', value: '', enabled: true }])} title="Add environment variable">+ Add variable</button>
              </>
            )}
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="ghost-action" onClick={() => setShowEnvEditor(false)} title="Cancel">Cancel</button>
              {editingEnvId && <button className="danger-action" onClick={() => deleteEnvironment(editingEnvId)} style={{ marginRight: 'auto' }} title="Delete environment">Delete</button>}
              <button className="secondary-button" onClick={saveEnvironment} disabled={!envName.trim()} title="Save environment">Save</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

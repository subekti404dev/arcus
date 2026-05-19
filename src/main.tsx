import React, { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCurl } from './curl';
import { sendNativeHttpRequest } from './http';
import { JsonTree, type JsonValue } from './JsonTree';
import { importPostmanCollection, exportAsPostmanCollection } from './postman';
import Dropdown from './Dropdown';
import { loadJson, saveJson } from './storage';
import type { AuthState, AuthType, Collection, Environment, HeaderRow, HttpMethod } from './types';
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from './windowControls';
import './styles.css';
type RequestHistory = {
  id: string;
  method: HttpMethod;
  url: string;
  status?: number;
  durationMs?: number;
  createdAt: string;
};

type ResponseState = {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: string;
};

type BodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded';
type BodyRow = { id: string; key: string; value: string; enabled: boolean };

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const collectionsStorageKey = 'arcus:collections';
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

function defaultHeaders(): HeaderRow[] {
  return [{ id: uid(), key: 'Accept', value: 'application/json', enabled: true }];
}

function defaultBodyRows(): BodyRow[] {
  return [{ id: uid(), key: '', value: '', enabled: true }];
}

function defaultAuth(): AuthState {
  return { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKey: '', apiValue: '', apiIn: 'header' };
}

function App() {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/todos/1');
  const [headers, setHeaders] = useState<HeaderRow[]>(() => defaultHeaders());
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState<BodyType>('raw');
  const [bodyRows, setBodyRows] = useState<BodyRow[]>(() => defaultBodyRows());
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [curlInput, setCurlInput] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [responseView, setResponseView] = useState<'preview' | 'raw' | 'headers'>('preview');
  const [auth, setAuth] = useState<AuthState>(() => defaultAuth());
  const [collections, setCollections] = useState<Collection[]>(() => loadJson<Collection[]>(collectionsStorageKey, []));
  const [environments, setEnvironments] = useState<Environment[]>(() => loadJson<Environment[]>(environmentsStorageKey, []));
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string>('');
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState<string>('');
  const [envName, setEnvName] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string; enabled: boolean }[]>([{ key: '', value: '', enabled: true }]);
  const [selectedCollectionId, setSelectedCollectionId] = useState(''); // sidebar selection only
  const [requestName, setRequestName] = useState('');
  const [activeSavedRequestId, setActiveSavedRequestId] = useState('');
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [deleteTargetCollectionId, setDeleteTargetCollectionId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingRequestId, setRenamingRequestId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [menuState, setMenuState] = useState<{ requestId: string; collectionId: string; rect: DOMRect; name: string } | null>(null);
  const [deleteTargetRequest, setDeleteTargetRequest] = useState<{ collectionId: string; requestId: string; name: string } | null>(null);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalCollectionId, setSaveModalCollectionId] = useState('');
  const [saveModalNewName, setSaveModalNewName] = useState('');
  const [saveModalSelectedRequestId, setSaveModalSelectedRequestId] = useState('');
  const [bulkEditHeaders, setBulkEditHeaders] = useState(false);
  const [bulkHeadersRaw, setBulkHeadersRaw] = useState('');

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
    saveJson(collectionsStorageKey, collections);
  }, [collections]);

  useEffect(() => {
    saveJson(environmentsStorageKey, environments);
  }, [environments]);

  useEffect(() => {
    localStorage.setItem(activeEnvStorageKey, activeEnvironmentId);
  }, [activeEnvironmentId]);

  useEffect(() => {
    const savedId = localStorage.getItem(activeEnvStorageKey);
    if (savedId) setActiveEnvironmentId(savedId);
  }, []);

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
    const res = await fetch(effectiveUrl, {
      method,
      headers: requestHeaders,
      body: canHaveBody && (bodyType !== 'raw' || body.trim()) ? encodedBody : undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      statusText: res.statusText,
      durationMs: Math.round(performance.now() - startedAt),
      headers: Object.fromEntries(res.headers.entries()),
      body: text,
    };
  }

  async function sendRequest() {
    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const result = window.__TAURI_INTERNALS__
        ? await sendNativeHttpRequest({ method, url: effectiveUrl, headers: Object.entries(requestHeaders).map(([key, value]) => ({ id: uid(), key, value, enabled: true })), body: canHaveBody && bodyType !== 'form-data' ? (bodyType === 'raw' ? resolvedBody : String(encodedBody)) : body })
        : await sendWithFetch();

      setResponse({
        status: result.status,
        statusText: 'status_text' in result ? result.status_text : result.statusText,
        durationMs: 'duration_ms' in result ? Number(result.duration_ms) : result.durationMs,
        headers: result.headers,
        body: prettyJson(result.body),
      });
      setResponseView('preview');
      setHistory((items) => [
        { id: uid(), method, url: effectiveUrl, status: result.status, durationMs: 'duration_ms' in result ? Number(result.duration_ms) : result.durationMs, createdAt: new Date().toLocaleString() },
        ...items.slice(0, 19),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown request error';
      setError(message);
      setHistory((items) => [
        { id: uid(), method, url: effectiveUrl, createdAt: new Date().toLocaleString() },
        ...items.slice(0, 19),
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

  function createCollection() {
    if (!newCollectionName.trim()) return;
    const now = new Date().toISOString();
    const collection: Collection = { id: uid(), name: newCollectionName.trim(), requests: [], createdAt: now, updatedAt: now };
    setCollections((items) => [collection, ...items]);
    setSelectedCollectionId(collection.id);
    setNewCollectionName('');
    setShowCollectionModal(false);
  }

  function openEnvEditor(env?: Environment) {
    if (env) {
      setEditingEnvId(env.id);
      setEnvName(env.name);
      setEnvVars(env.variables.length > 0 ? env.variables : [{ key: '', value: '', enabled: true }]);
    } else {
      setEditingEnvId('');
      setEnvName('');
      setEnvVars([{ key: '', value: '', enabled: true }]);
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

  const saveModalRequests = useMemo(() => {
    return collections.find((c) => c.id === saveModalCollectionId)?.requests ?? [];
  }, [collections, saveModalCollectionId]);

  function toggleBulkHeaders() {
    if (!bulkEditHeaders) {
      setBulkHeadersRaw(headers.map((h) => `${h.key}: ${h.value}`).join('\n'));
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

  function applyBulkHeaders(text: string) {
    const parsed: HeaderRow[] = [];
    for (const line of text.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) parsed.push({ id: uid(), key, value, enabled: true });
    }
    setHeaders(parsed.length > 0 ? parsed : defaultHeaders());
  }

  function openSaveModal() {
    if (!url.trim()) return;
    setSaveModalNewName(requestName || `${method} ${url}`);
    setSaveModalCollectionId(selectedCollectionId || (collections.length > 0 ? collections[0].id : ''));
    setSaveModalSelectedRequestId(activeSavedRequestId && selectedCollectionId ? activeSavedRequestId : '');
    setShowSaveModal(true);
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
            ...request, name, method, url, headers, body, auth, updatedAt: now,
          } : request),
        };
      }

      const newId = uid();
      return {
        ...collection,
        updatedAt: now,
        requests: [
          { id: newId, name, method, url, headers, body, auth, createdAt: now, updatedAt: now },
          ...collection.requests,
        ],
      };
    }));

    setRequestName(name);
    setShowSaveModal(false);
  }

  function loadSavedRequest(collectionId: string, requestId: string) {
    const saved = collections.find((collection) => collection.id === collectionId)?.requests.find((request) => request.id === requestId);
    if (!saved) return;
    setMethod(saved.method);
    setUrl(saved.url);
    setHeaders(saved.headers);
    setBody(saved.body);
    setBodyType('raw');
    setBodyRows(defaultBodyRows());
    setAuth(saved.auth ?? defaultAuth());
    setRequestName(saved.name);
    setActiveSavedRequestId(saved.id);
    setSelectedCollectionId(collectionId);
    setResponse(null);
    setError('');
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

  async function copyAsCurl() {
    const lines = [`curl ${shellQuote(effectiveUrl)}`];

    if (method !== 'GET') {
      lines.push(`  -X ${method}`);
    }

    Object.entries(requestHeaders).forEach(([key, value]) => {
      lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
    });

    const exportBody = getRequestBodyForExport();
    if (exportBody) {
      lines.push(`  --data-raw ${shellQuote(exportBody)}`);
    }

    const curl = lines.join(' \\\n');
    await navigator.clipboard.writeText(curl);
    setToastMessage('Copied as cURL.');
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

  function importCurl() {
    try {
      const parsed = parseCurl(curlInput);
      setMethod(parsed.method);
      setUrl(parsed.url);
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
          <span className="app-dot" />
          <strong data-tauri-drag-region>Arcus</strong>
        </div>
        <div className="window-controls">
          <button onClick={minimizeWindow} aria-label="Minimize window">−</button>
          <button onClick={toggleMaximizeWindow} aria-label="Maximize window">□</button>
          <button className="close-window" onClick={closeWindow} aria-label="Close window">×</button>
        </div>
      </header>
      <div className="shell">
      <aside className="sidebar">
        <div className="brand">Arcus</div>
        <button className="new-button" onClick={() => { setMethod('GET'); setUrl(''); setHeaders(defaultHeaders()); setBody(''); setBodyType('raw'); setBodyRows(defaultBodyRows()); setAuth(defaultAuth()); setRequestName(''); setActiveSavedRequestId(''); setResponse(null); setError(''); }}>
          + New Request
        </button>
        <button className="import-button" onClick={() => { setShowImportModal(true); setCurlInput(''); setImportMessage(''); }}>
          Import cURL
        </button>
        <button className="import-button" onClick={() => fileInputRef.current?.click()} style={{ background: 'rgba(100,116,139,.14)', borderColor: '#64748b', color: '#cbd5e1' }}>
          Import Collection
        </button>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportCollection} style={{ display: 'none' }} />
        <div className="collections-header">
          <h3>Collections</h3>
          <button onClick={() => setShowCollectionModal(true)} title="New collection">+</button>
        </div>
        {collections.length > 0 && (
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search collections..." className="search-input" autoComplete="off" />
        )}
        {collections.length === 0 && <p className="muted">No collections yet.</p>}
        {collections.length > 0 && filteredCollections.length === 0 && <p className="muted small">No matching results.</p>}
        <div className="collection-list">
          {filteredCollections.map((collection) => (
            <details className="collection-item" key={collection.id} open={selectedCollectionId === collection.id} onToggle={(event) => { if (event.currentTarget.open) setSelectedCollectionId(collection.id); }}>
              <summary>
                <span>{collection.name}</span>
                <small>{collection.requests.length}</small>
                <button className="export-collection-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExportCollection(collection); }} title="Export as Postman collection">↗</button>
              </summary>
              <div className="saved-request-list">
                {collection.requests.map((saved) => (
                  <div className="saved-request" key={saved.id}>
                    {renamingRequestId === saved.id ? (
                      <div className="rename-row">
                        <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') commitRename(collection.id); if (e.key === 'Escape') setRenamingRequestId(''); }} />
                        <button onClick={() => commitRename(collection.id)} title="Confirm rename">✓</button>
                        <button onClick={() => setRenamingRequestId('')} title="Cancel rename">×</button>
                      </div>
                    ) : (
                      <button className={activeSavedRequestId === saved.id ? 'active' : ''} onClick={() => loadSavedRequest(collection.id, saved.id)}>
                        <strong className={methodColorClass(saved.method)}>{saved.method}</strong>
                        <span>{saved.name}</span>
                      </button>
                    )}
                    <div className="saved-request-menu">
                      <button className="menu-trigger" onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenuState(menuState?.requestId === saved.id ? null : { requestId: saved.id, collectionId: collection.id, rect, name: saved.name }); }} title="More actions">⋮</button>
                    </div>
                  </div>
                ))}
                {collection.requests.length === 0 && <p className="muted small">No saved requests.</p>}
                <button className="delete-collection" onClick={() => openDeleteCollectionModal(collection.id)}>Delete collection</button>
              </div>
            </details>
          ))}
        </div>

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
                <button className="env-edit-btn" onClick={(e) => { e.stopPropagation(); openEnvEditor(env); }}>✎</button>
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
            <button className="history-item" key={item.id} onClick={() => { setMethod(item.method); setUrl(item.url); }}>
              <strong className={item.method ? methodColorClass(item.method) : ''}>{item.method}</strong>
              <span>{item.url}</span>
              <small><span className={item.status ? statusBadgeClass(item.status) : 'status-err'}>{item.status ?? 'err'}</span> · {item.status ? `${item.durationMs}ms` : 'failed'} · {item.createdAt}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <div className="request-bar">
          <Dropdown
            value={method}
            onChange={(v) => setMethod(v as HttpMethod)}
            options={methods.map((m) => ({ value: m, label: m }))}
          />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter request URL" />
          <button onClick={sendRequest} disabled={loading || !url.trim()}>{loading ? 'Sending...' : 'Send'}</button>
          <button onClick={openSaveModal} disabled={!url.trim()} className="save-request-button">Save</button>
          <button onClick={copyAsCurl} disabled={!url.trim()} className="copy-curl-button">Copy cURL</button>
        </div>
        {toastMessage && <div className="toast-message">{toastMessage}</div>}

        <div className="panels">
          <section className="card request-card">
            <h2>Request</h2>
            <div className="section-title">
              Headers
              <button className="bulk-edit-toggle" onClick={toggleBulkHeaders}>
                {bulkEditHeaders ? 'Key-Value' : 'Bulk Edit'}
              </button>
            </div>
            {bulkEditHeaders ? (
              <textarea
                className="bulk-headers-input"
                value={bulkHeadersRaw}
                onChange={(e) => handleBulkHeadersChange(e.target.value)}
                placeholder="Content-Type: application/json&#10;Authorization: Bearer token"
              />
            ) : (
              <>
                <div className="headers-table">
                  {headers.map((row) => (
                    <div className="header-row" key={row.id}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => updateHeader(row.id, { enabled: e.target.checked })} />
                      <input value={row.key} onChange={(e) => updateHeader(row.id, { key: e.target.value })} placeholder="Header" />
                      <input value={row.value} onChange={(e) => updateHeader(row.id, { value: e.target.value })} placeholder="Value" />
                      <button className="ghost" onClick={() => setHeaders((rows) => rows.filter((item) => item.id !== row.id))}>×</button>
                    </div>
                  ))}
                </div>
                <button className="link-button" onClick={() => setHeaders((rows) => [...rows, { id: uid(), key: '', value: '', enabled: true }])}>+ Add header</button>
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
                {bodyType === 'raw' && <button className="format-button" onClick={formatRequestBodyJson} disabled={!canHaveBody || !body.trim()}>Format JSON</button>}
              </div>
            </div>
            {bodyType === 'raw' ? (
              <textarea disabled={!canHaveBody} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={handleBodyKeyDown} onBlur={() => { if (body.trim()) formatRequestBodyJson(); }} placeholder={canHaveBody ? '{\n  "hello": "world"\n}' : 'Body disabled for this method'} />
            ) : (
              <div className="body-table">
                {bodyRows.map((row) => (
                  <div className="body-row" key={row.id}>
                    <input type="checkbox" checked={row.enabled} onChange={(e) => updateBodyRow(row.id, { enabled: e.target.checked })} disabled={!canHaveBody} />
                    <input value={row.key} onChange={(e) => updateBodyRow(row.id, { key: e.target.value })} placeholder="Key" disabled={!canHaveBody} />
                    <input value={row.value} onChange={(e) => updateBodyRow(row.id, { value: e.target.value })} placeholder="Value" disabled={!canHaveBody} />
                    <button className="ghost" onClick={() => setBodyRows((rows) => rows.filter((item) => item.id !== row.id))} disabled={!canHaveBody}>×</button>
                  </div>
                ))}
                <button className="link-button" onClick={() => setBodyRows((rows) => [...rows, { id: uid(), key: '', value: '', enabled: true }])} disabled={!canHaveBody}>+ Add field</button>
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
                  <span>{response.durationMs}ms</span>
                  <span>{Object.keys(response.headers).length} headers</span>
                </div>
                <div className="response-body-header">
                  <div className="section-title">{responseView === 'headers' ? 'Response Headers' : 'Response Body'}</div>
                  <button className="copy-body-button" onClick={copyResponseBody} title="Copy response body">Copy</button>
                  <div className="view-tabs" role="tablist" aria-label="Response view mode">
                    <button className={responseView === 'preview' ? 'active' : ''} onClick={() => setResponseView('preview')} role="tab" aria-selected={responseView === 'preview'}>Preview</button>
                    <button className={responseView === 'raw' ? 'active' : ''} onClick={() => setResponseView('raw')} role="tab" aria-selected={responseView === 'raw'}>Raw</button>
                    <button className={responseView === 'headers' ? 'active' : ''} onClick={() => setResponseView('headers')} role="tab" aria-selected={responseView === 'headers'}>Headers</button>
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
                ) : responseView === 'preview' && responseJson !== null ? <JsonTree data={responseJson} /> : <pre>{response.body}</pre>}
              </>
            )}
          </section>
        </div>
      </section>
      </div>

      {menuState && (
        <>
          <div className="menu-backdrop" onClick={() => setMenuState(null)} />
          <div className="menu-dropdown" style={{ position: 'fixed', top: menuState.rect.bottom + 4, right: window.innerWidth - menuState.rect.right, zIndex: 100 }}>
            <button onClick={() => { duplicateSavedRequest(menuState.collectionId, menuState.requestId); setMenuState(null); }}>⧉ Duplicate</button>
            <button onClick={() => { startRename(menuState.requestId, menuState.name); setMenuState(null); }}>✎ Rename</button>
            <button className="menu-danger" onClick={() => { setDeleteTargetRequest({ collectionId: menuState.collectionId, requestId: menuState.requestId, name: menuState.name }); setMenuState(null); }}>× Delete</button>
          </div>
        </>
      )}

      {showCollectionModal && (
        <div className="modal-backdrop" onClick={() => setShowCollectionModal(false)}>
          <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-collection-title">
            <div className="import-header">
              <div>
                <h2 id="add-collection-title">Add Collection</h2>
                <p>Create a folder to organize saved API requests.</p>
              </div>
              <button className="close-button" onClick={() => setShowCollectionModal(false)} aria-label="Close add collection modal">×</button>
            </div>
            <input className="modal-input" value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createCollection(); }} placeholder="Collection name" autoFocus />
            <div className="modal-actions">
              <button className="ghost-action" onClick={() => { setNewCollectionName(''); setShowCollectionModal(false); }}>Cancel</button>
              <button className="secondary-button" onClick={createCollection} disabled={!newCollectionName.trim()}>Create</button>
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
              <button className="ghost-action" onClick={() => setDeleteTargetCollectionId('')}>Cancel</button>
              <button className="danger-action" onClick={() => deleteCollection(deleteTargetCollectionId)}>Delete</button>
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
              <button className="ghost-action" onClick={() => setDeleteTargetRequest(null)}>Cancel</button>
              <button className="danger-action" onClick={() => { deleteSavedRequest(deleteTargetRequest.collectionId, deleteTargetRequest.requestId); setDeleteTargetRequest(null); }}>Delete</button>
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
              <button className="ghost-action" onClick={() => setShowClearHistoryModal(false)}>Cancel</button>
              <button className="danger-action" onClick={() => { setHistory([]); setShowClearHistoryModal(false); }}>Clear All</button>
            </div>
          </section>
        </div>
      )}

      {showSaveModal && (
        <div className="modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
            <div className="import-header">
              <div>
                <h2 id="save-modal-title">Save Request</h2>
                <p>{saveModalSelectedRequestId ? 'Update existing request or type a new name to save as new.' : 'Select a collection and name your request.'}</p>
              </div>
              <button className="close-button" onClick={() => setShowSaveModal(false)} aria-label="Close save modal">×</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Dropdown
                value={saveModalCollectionId}
                onChange={(id) => { setSaveModalCollectionId(id); setSaveModalSelectedRequestId(''); }}
                options={[{ value: '', label: 'Select collection...' }, ...collections.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            {saveModalRequests.length > 0 && (
              <div className="save-modal-requests">
                {saveModalRequests.map((req) => (
                  <button
                    key={req.id}
                    className={`save-modal-request-item ${req.id === saveModalSelectedRequestId ? 'save-modal-request-selected' : ''}`}
                    onClick={() => { setSaveModalSelectedRequestId(req.id); setSaveModalNewName(req.name); }}
                  >
                    <strong className={methodColorClass(req.method)}>{req.method}</strong>
                    <span>{req.name}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              className="modal-input"
              value={saveModalNewName}
              onChange={(e) => { setSaveModalNewName(e.target.value); setSaveModalSelectedRequestId(''); }}
              placeholder="Request name"
              onKeyDown={(e) => { if (e.key === 'Enter') doSaveRequest(); }}
              style={{ marginTop: 12 }}
            />
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="ghost-action" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="secondary-button" onClick={doSaveRequest} disabled={!saveModalCollectionId || !saveModalNewName.trim()}>
                {saveModalSelectedRequestId ? 'Update' : 'Save as New'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="import-curl-title">
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
              <button className="ghost-action" onClick={() => { setCurlInput(''); setImportMessage(''); }}>Clear</button>
              <button className="secondary-button" onClick={importCurl} disabled={!curlInput.trim()}>Import</button>
            </div>
          </section>
        </div>
      )}

      {showEnvEditor && (
        <div className="modal-backdrop" onClick={() => setShowEnvEditor(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="env-editor-title">
            <div className="import-header">
              <div>
                <h2 id="env-editor-title">{editingEnvId ? 'Edit Environment' : 'New Environment'}</h2>
                <p>Define variables to use as {"{{name}}"} in URLs, headers, and body.</p>
              </div>
              <button className="close-button" onClick={() => setShowEnvEditor(false)} aria-label="Close environment editor">×</button>
            </div>
            <input className="modal-input" value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="Environment name (e.g. Development, Production)" style={{ marginBottom: 16 }} autoFocus />
            <div className="env-vars-table">
              {envVars.map((v, i) => (
                <div className="header-row" key={i}>
                  <input type="checkbox" checked={v.enabled} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], enabled: e.target.checked }; setEnvVars(next); }} />
                  <input value={v.key} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], key: e.target.value }; setEnvVars(next); }} placeholder="VAR_NAME" />
                  <input value={v.value} onChange={(e) => { const next = [...envVars]; next[i] = { ...next[i], value: e.target.value }; setEnvVars(next); }} placeholder="value" />
                  <button className="ghost" onClick={() => setEnvVars((prev) => prev.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <button className="link-button" onClick={() => setEnvVars((prev) => [...prev, { key: '', value: '', enabled: true }])}>+ Add variable</button>
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="ghost-action" onClick={() => setShowEnvEditor(false)}>Cancel</button>
              {editingEnvId && <button className="danger-action" onClick={() => deleteEnvironment(editingEnvId)} style={{ marginRight: 'auto' }}>Delete</button>}
              <button className="secondary-button" onClick={saveEnvironment} disabled={!envName.trim()}>Save</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

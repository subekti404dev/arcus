import React, { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCurl } from './curl';
import { sendNativeHttpRequest } from './http';
import { JsonTree, type JsonValue } from './JsonTree';
import { loadJson, saveJson } from './storage';
import type { Collection, HeaderRow, HttpMethod } from './types';
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

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const collectionsStorageKey = 'postman-tauri:collections';

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
  const [collections, setCollections] = useState<Collection[]>(() => loadJson<Collection[]>(collectionsStorageKey, []));
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [requestName, setRequestName] = useState('');
  const [activeSavedRequestId, setActiveSavedRequestId] = useState('');
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [deleteTargetCollectionId, setDeleteTargetCollectionId] = useState('');

  const canHaveBody = !['GET', 'DELETE'].includes(method);
  const responseJson = useMemo(() => response ? parseJson(response.body) : null, [response]);
  const activeSavedRequestExists = useMemo(() => {
    if (!selectedCollectionId || !activeSavedRequestId) return false;
    return collections.some((collection) => collection.id === selectedCollectionId && collection.requests.some((request) => request.id === activeSavedRequestId));
  }, [activeSavedRequestId, collections, selectedCollectionId]);

  useEffect(() => {
    saveJson(collectionsStorageKey, collections);
  }, [collections]);

  const activeHeaders = useMemo(() => {
    return headers.reduce<Record<string, string>>((acc, row) => {
      if (row.enabled && row.key.trim()) acc[row.key.trim()] = row.value;
      return acc;
    }, {});
  }, [headers]);

  const encodedBody = useMemo(() => {
    const rows = bodyRows.filter((row) => row.enabled && row.key.trim());
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
    const nextHeaders = { ...activeHeaders };
    if (bodyType === 'x-www-form-urlencoded') {
      nextHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (bodyType === 'form-data') {
      Object.keys(nextHeaders).forEach((key) => {
        if (key.toLowerCase() === 'content-type') delete nextHeaders[key];
      });
    }
    return nextHeaders;
  }, [activeHeaders, bodyType]);

  async function sendWithFetch() {
    const startedAt = performance.now();
    const res = await fetch(url, {
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
        ? await sendNativeHttpRequest({ method, url, headers: Object.entries(requestHeaders).map(([key, value]) => ({ id: uid(), key, value, enabled: true })), body: canHaveBody && bodyType !== 'form-data' ? String(encodedBody) : body })
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
        { id: uid(), method, url, status: result.status, durationMs: 'duration_ms' in result ? Number(result.duration_ms) : result.durationMs, createdAt: new Date().toLocaleString() },
        ...items.slice(0, 19),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown request error';
      setError(message);
      setHistory((items) => [
        { id: uid(), method, url, createdAt: new Date().toLocaleString() },
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

  function deleteCollection(collectionId: string) {
    setCollections((items) => items.filter((collection) => collection.id !== collectionId));
    if (selectedCollectionId === collectionId) setSelectedCollectionId('');
    setDeleteTargetCollectionId('');
  }

  function openDeleteCollectionModal(collectionId: string) {
    setDeleteTargetCollectionId(collectionId);
  }

  function saveCurrentRequest() {
    if (!selectedCollectionId) {
      alert('Create or select a collection first.');
      return;
    }

    const now = new Date().toISOString();
    const name = requestName.trim() || `${method} ${url || 'Untitled request'}`;
    const shouldUpdate = activeSavedRequestExists;
    const newRequestId = shouldUpdate ? activeSavedRequestId : uid();

    setCollections((items) => items.map((collection) => {
      if (collection.id !== selectedCollectionId) return collection;

      if (shouldUpdate) {
        return {
          ...collection,
          updatedAt: now,
          requests: collection.requests.map((request) => request.id === activeSavedRequestId ? {
            ...request,
            name,
            method,
            url,
            headers,
            body,
            updatedAt: now,
          } : request),
        };
      }

      return {
        ...collection,
        updatedAt: now,
        requests: [
          {
            id: newRequestId,
            name,
            method,
            url,
            headers,
            body,
            createdAt: now,
            updatedAt: now,
          },
          ...collection.requests,
        ],
      };
    }));
    setActiveSavedRequestId(newRequestId);
    setRequestName(name);
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
    const lines = [`curl ${shellQuote(url)}`];

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

  function importCurl() {
    try {
      const parsed = parseCurl(curlInput);
      setMethod(parsed.method);
      setUrl(parsed.url);
      setHeaders(parsed.headers);
      setBody(parsed.body);
      setBodyType('raw');
      setBodyRows(defaultBodyRows());
      setResponse(null);
      setError('');
      setRequestName('');
      setActiveSavedRequestId('');
      setImportMessage('cURL imported successfully.');
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
          <strong data-tauri-drag-region>Postman<span>Tauri</span></strong>
        </div>
        <div className="window-controls">
          <button onClick={minimizeWindow} aria-label="Minimize window">−</button>
          <button onClick={toggleMaximizeWindow} aria-label="Maximize window">□</button>
          <button className="close-window" onClick={closeWindow} aria-label="Close window">×</button>
        </div>
      </header>
      <div className="shell">
      <aside className="sidebar">
        <div className="brand">Postman<span>Tauri</span></div>
        <button className="new-button" onClick={() => { setMethod('GET'); setUrl(''); setHeaders(defaultHeaders()); setBody(''); setBodyType('raw'); setBodyRows(defaultBodyRows()); setRequestName(''); setActiveSavedRequestId(''); setResponse(null); setError(''); }}>
          + New Request
        </button>
        <button className="import-button" onClick={() => { setShowImportModal(true); setImportMessage(''); }}>
          Import cURL
        </button>
        <div className="collections-header">
          <h3>Collections</h3>
          <button onClick={() => setShowCollectionModal(true)} title="New collection">+</button>
        </div>
        {collections.length === 0 && <p className="muted">No collections yet.</p>}
        <div className="collection-list">
          {collections.map((collection) => (
            <details className="collection-item" key={collection.id} open={selectedCollectionId === collection.id} onToggle={(event) => { if (event.currentTarget.open) setSelectedCollectionId(collection.id); }}>
              <summary>
                <span>{collection.name}</span>
                <small>{collection.requests.length}</small>
              </summary>
              <div className="saved-request-list">
                {collection.requests.map((saved) => (
                  <div className="saved-request" key={saved.id}>
                    <button className={activeSavedRequestId === saved.id ? 'active' : ''} onClick={() => loadSavedRequest(collection.id, saved.id)}>
                      <strong>{saved.method}</strong>
                      <span>{saved.name}</span>
                    </button>
                    <button className="delete-mini" onClick={() => deleteSavedRequest(collection.id, saved.id)} title="Delete request">×</button>
                  </div>
                ))}
                {collection.requests.length === 0 && <p className="muted small">No saved requests.</p>}
                <button className="delete-collection" onClick={() => openDeleteCollectionModal(collection.id)}>Delete collection</button>
              </div>
            </details>
          ))}
        </div>

        <h3>History</h3>
        <div className="history-list">
          {history.length === 0 && <p className="muted">No requests yet.</p>}
          {history.map((item) => (
            <button className="history-item" key={item.id} onClick={() => { setMethod(item.method); setUrl(item.url); }}>
              <strong>{item.method}</strong>
              <span>{item.url}</span>
              <small>{item.status ? `${item.status} · ${item.durationMs}ms` : 'failed'} · {item.createdAt}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <div className="save-bar">
          <select value={selectedCollectionId} onChange={(event) => setSelectedCollectionId(event.target.value)}>
            <option value="">Select collection</option>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
          <input value={requestName} onChange={(event) => setRequestName(event.target.value)} placeholder="Request name" />
          <button onClick={saveCurrentRequest} disabled={!selectedCollectionId || !url.trim()}>{activeSavedRequestExists ? 'Update' : 'Save'}</button>
        </div>

        <div className="request-bar">
          <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {methods.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter request URL" />
          <button onClick={copyAsCurl} disabled={!url.trim()} className="copy-curl-button">Copy cURL</button>
          <button onClick={sendRequest} disabled={loading || !url.trim()}>{loading ? 'Sending...' : 'Send'}</button>
        </div>
        {toastMessage && <div className="toast-message">{toastMessage}</div>}

        <div className="panels">
          <section className="card request-card">
            <h2>Request</h2>
            <div className="section-title">Headers</div>
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

            <div className="body-header">
              <div className="section-title">Body</div>
              <div className="body-actions">
                <select value={bodyType} onChange={(event) => setBodyType(event.target.value as BodyType)} disabled={!canHaveBody}>
                  <option value="raw">raw</option>
                  <option value="form-data">form-data</option>
                  <option value="x-www-form-urlencoded">x-www-form-urlencoded</option>
                </select>
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
                  <span className={response.status < 400 ? 'ok' : 'bad'}>{response.status} {response.statusText}</span>
                  <span>{response.durationMs}ms</span>
                  <span>{Object.keys(response.headers).length} headers</span>
                </div>
                <div className="response-body-header">
                  <div className="section-title">{responseView === 'headers' ? 'Response Headers' : 'Response Body'}</div>
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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

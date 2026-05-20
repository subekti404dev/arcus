import type { Collection, SavedRequest, AuthState, HeaderRow, HttpMethod, QueryRow, CollectionFolder } from './types';

// ── Postman v2.1 JSON shapes ──

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanQueryParam {
  key: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: PostmanQueryParam[];
}

interface PostmanBody {
  mode: string;
  raw?: string;
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url: PostmanUrl | string;
}

interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  item?: PostmanItem[]; // folder
}

interface PostmanCollection {
  info: { name: string; _postman_id?: string; schema?: string };
  item: PostmanItem[];
}

// ── Import ──

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return new Date().toISOString();
}

const supportedMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

function normalizeMethod(method?: string): HttpMethod {
  const upper = (method || 'GET').toUpperCase() as HttpMethod;
  return supportedMethods.includes(upper) ? upper : 'GET';
}

function defaultAuth(): AuthState {
  return { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKey: '', apiValue: '', apiIn: 'header' };
}

function urlFromPostman(url: PostmanUrl | string | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;

  const protocol = url.protocol ? `${url.protocol}://` : '';
  const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? '';
  const path = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
  const query = (url.query ?? [])
    .filter((q) => q.key)
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
    .join('&');

  const slash = host && path && !path.startsWith('/') ? '/' : '';
  return `${protocol}${host}${slash}${path}${query ? `?${query}` : ''}`;
}

function queryRowsFromPostman(url: PostmanUrl | string | undefined): QueryRow[] {
  if (!url || typeof url === 'string') return [];
  return (url.query ?? [])
    .filter((q) => q.key)
    .map((q) => ({ id: uid(), key: q.key, value: q.value ?? '', enabled: !q.disabled }));
}

function convertRequest(item: PostmanItem, folderId?: string): SavedRequest {
  const req = item.request!;
  const headers: HeaderRow[] = (req.header ?? []).map((h) => ({
    id: uid(),
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));

  return {
    id: uid(),
    name: item.name,
    folderId,
    method: normalizeMethod(req.method),
    url: urlFromPostman(req.url),
    headers,
    queryParams: queryRowsFromPostman(req.url),
    body: req.body?.mode === 'raw' ? req.body.raw ?? '' : req.body?.raw ?? '',
    auth: defaultAuth(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function convertItems(items: PostmanItem[], folders: CollectionFolder[], parentId?: string): SavedRequest[] {
  const results: SavedRequest[] = [];

  for (const item of items) {
    if (item.request) {
      results.push(convertRequest(item, parentId));
      continue;
    }

    if (item.item) {
      const folder: CollectionFolder = { id: uid(), name: item.name, parentId, createdAt: now(), updatedAt: now() };
      folders.push(folder);
      results.push(...convertItems(item.item, folders, folder.id));
    }
  }

  return results;
}

export function importPostmanCollection(json: string): { collection: Collection; requestCount: number } {
  const parsed: PostmanCollection = JSON.parse(json);

  if (!parsed.info || !Array.isArray(parsed.item)) {
    throw new Error('Not a valid Postman collection (missing info or item).');
  }

  const folders: CollectionFolder[] = [];
  const requests = convertItems(parsed.item, folders);

  const collection: Collection = {
    id: uid(),
    name: parsed.info.name || 'Imported Collection',
    folders,
    requests,
    createdAt: now(),
    updatedAt: now(),
  };

  return { collection, requestCount: requests.length };
}

// ── Export ──

function convertToPostmanItem(request: SavedRequest): PostmanItem {
  const query = (request.queryParams ?? [])
    .filter((q) => q.key)
    .map((q) => ({ key: q.key, value: q.value, ...(q.enabled ? {} : { disabled: true }) }));

  return {
    name: request.name,
    request: {
      method: request.method,
      header: request.headers
        .filter((h) => h.key)
        .map((h) => ({
          key: h.key,
          value: h.value,
          ...(h.enabled ? {} : { disabled: true }),
        })),
      body: request.body
        ? {
            mode: 'raw',
            raw: request.body,
          }
        : undefined,
      url: {
        raw: request.url,
        ...(query.length ? { query } : {}),
      },
    },
  };
}

function folderItem(folder: CollectionFolder, collection: Collection, folders: CollectionFolder[]): PostmanItem {
  const childFolders = folders.filter((item) => item.parentId === folder.id);
  const requests = collection.requests.filter((request) => request.folderId === folder.id);

  return {
    name: folder.name,
    item: [
      ...childFolders.map((child) => folderItem(child, collection, folders)),
      ...requests.map(convertToPostmanItem),
    ],
  };
}

export function exportAsPostmanCollection(collection: Collection): string {
  const items: PostmanItem[] = [];
  const folders = collection.folders ?? [];
  const folderIds = new Set(folders.map((folder) => folder.id));

  for (const folder of folders.filter((item) => !item.parentId || !folderIds.has(item.parentId))) {
    items.push(folderItem(folder, collection, folders));
  }

  for (const request of collection.requests) {
    if (!request.folderId || !folderIds.has(request.folderId)) {
      items.push(convertToPostmanItem(request));
    }
  }

  const postman: PostmanCollection = {
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };

  return JSON.stringify(postman, null, 2);
}

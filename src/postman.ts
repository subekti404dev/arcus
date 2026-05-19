import type { Collection, SavedRequest, AuthState, HeaderRow, HttpMethod } from './types';

// ── Postman v2.1 JSON shapes ──

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw: string;
}

interface PostmanBody {
  mode: string;
  raw?: string;
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url: PostmanUrl;
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

function convertRequest(item: PostmanItem): SavedRequest {
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
    method: (req.method.toUpperCase() as HttpMethod) || 'GET',
    url: req.url?.raw ?? '',
    headers,
    body: req.body?.raw ?? '',
    auth: defaultAuth(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function defaultAuth(): AuthState {
  return { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKey: '', apiValue: '', apiIn: 'header' };
}

function flattenItems(items: PostmanItem[], parentPrefix = ''): SavedRequest[] {
  const results: SavedRequest[] = [];
  for (const item of items) {
    if (item.request) {
      const request = convertRequest(item);
      if (parentPrefix) {
        request.name = `${parentPrefix} / ${request.name}`;
      }
      results.push(request);
    }
    if (item.item) {
      results.push(...flattenItems(item.item, parentPrefix ? `${parentPrefix} / ${item.name}` : item.name));
    }
  }
  return results;
}

export function importPostmanCollection(json: string): { collection: Collection; requestCount: number } {
  const parsed: PostmanCollection = JSON.parse(json);

  if (!parsed.info || !Array.isArray(parsed.item)) {
    throw new Error('Not a valid Postman collection (missing info or item).');
  }

  const requests = flattenItems(parsed.item);

  const collection: Collection = {
    id: uid(),
    name: parsed.info.name || 'Imported Collection',
    requests,
    createdAt: now(),
    updatedAt: now(),
  };

  return { collection, requestCount: requests.length };
}

// ── Export ──

function convertToPostmanItem(request: SavedRequest): PostmanItem {
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
      },
    },
  };
}

export function exportAsPostmanCollection(collection: Collection): string {
  const postman: PostmanCollection = {
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: collection.requests.map(convertToPostmanItem),
  };

  return JSON.stringify(postman, null, 2);
}

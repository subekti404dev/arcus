import type { HeaderRow, HttpMethod } from './types';

type ParsedCurl = {
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  body: string;
};

const supportedMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function uid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function tokenize(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;

  const input = command.replace(/\\\r?\n/g, ' ');

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }

    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }

    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseHeader(value: string): HeaderRow | null {
  const separator = value.indexOf(':');
  if (separator < 0) return null;

  return {
    id: uid(),
    key: value.slice(0, separator).trim(),
    value: value.slice(separator + 1).trim(),
    enabled: true,
  };
}

function normalizeMethod(value: string): HttpMethod {
  const method = value.toUpperCase() as HttpMethod;
  if (!supportedMethods.includes(method)) {
    throw new Error(`Unsupported HTTP method: ${value}`);
  }
  return method;
}

export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenize(command.trim());
  if (!tokens.length || tokens[0] !== 'curl') {
    throw new Error('Paste a curl command that starts with `curl`.');
  }

  let method: HttpMethod | '' = '';
  let url = '';
  let body = '';
  const headers: HeaderRow[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === '-X' || token === '--request') {
      if (!next) throw new Error(`${token} requires a method.`);
      method = normalizeMethod(next);
      index += 1;
      continue;
    }

    if (token.startsWith('-X') && token.length > 2) {
      method = normalizeMethod(token.slice(2));
      continue;
    }

    if (token === '-H' || token === '--header') {
      if (!next) throw new Error(`${token} requires a header value.`);
      const header = parseHeader(next);
      if (header) headers.push(header);
      index += 1;
      continue;
    }

    if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-ascii' || token === '--data-urlencode') {
      if (!next) throw new Error(`${token} requires body data.`);
      body = body ? `${body}&${next}` : next;
      if (!method) method = 'POST';
      index += 1;
      continue;
    }

    if (token === '-G' || token === '--get' || token === '-i' || token === '--include' || token === '-s' || token === '--silent' || token === '-L' || token === '--location' || token === '--compressed') {
      continue;
    }

    if (!token.startsWith('-') && !url) {
      url = token;
    }
  }

  if (!url) throw new Error('Could not find URL in curl command.');

  return {
    method: method || 'GET',
    url,
    headers: headers.length ? headers : [{ id: uid(), key: 'Accept', value: 'application/json', enabled: true }],
    body,
  };
}

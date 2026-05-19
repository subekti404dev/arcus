import { invoke } from '@tauri-apps/api/core';
import type { HeaderRow, HttpMethod } from './types';

export type ResponseTimings = {
  total_ms: number;
  upload_ms: number;
  download_ms: number;
  first_byte_ms: number;
  body_read_ms: number;
};

export type NativeHttpResponse = {
  status: number;
  status_text: string;
  duration_ms: number;
  timings?: ResponseTimings;
  headers: Record<string, string>;
  body: string;
};

export type FormFieldInput = {
  key: string;
  value: string;
  fieldType: 'text' | 'file';
};

export async function sendNativeHttpRequest(input: {
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  body?: string;
  formFields?: FormFieldInput[];
}) {
  return invoke<NativeHttpResponse>('send_http_request', {
    input: {
      method: input.method,
      url: input.url,
      headers: input.headers
        .filter((row) => row.enabled && row.key.trim())
        .map((row) => ({ key: row.key.trim(), value: row.value })),
      body: input.body,
      formFields: input.formFields,
    },
  });
}

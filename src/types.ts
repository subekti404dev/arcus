export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HeaderRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type SavedRequest = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  body: string;
  auth: AuthState;
  createdAt: string;
  updatedAt: string;
};

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export type AuthState = {
  type: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  apiKey: string;
  apiValue: string;
  apiIn: 'header' | 'query';
};

export type Collection = {
  id: string;
  name: string;
  requests: SavedRequest[];
  createdAt: string;
  updatedAt: string;
};

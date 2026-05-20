export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type HeaderRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type QueryRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type SavedRequest = {
  id: string;
  name: string;
  folderId?: string;
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  queryParams: QueryRow[];
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

export type CollectionFolder = {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Collection = {
  id: string;
  name: string;
  folders?: CollectionFolder[];
  requests: SavedRequest[];
  createdAt: string;
  updatedAt: string;
};

export type Environment = {
  id: string;
  name: string;
  variables: { key: string; value: string; enabled: boolean }[];
  createdAt: string;
  updatedAt: string;
};

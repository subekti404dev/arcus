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
  createdAt: string;
  updatedAt: string;
};

export type Collection = {
  id: string;
  name: string;
  requests: SavedRequest[];
  createdAt: string;
  updatedAt: string;
};

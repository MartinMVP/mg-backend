export type ProviderHttpRequest = {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export type ProviderHttpResponse = {
  ok: boolean;
  status: number;
  body?: unknown;
  message: string;
};

export interface ProviderHttpClient {
  post(path: string, body?: unknown, options?: Omit<ProviderHttpRequest, 'method' | 'path' | 'body'>): Promise<ProviderHttpResponse>;
  get(path: string, options?: Omit<ProviderHttpRequest, 'method' | 'path'>): Promise<ProviderHttpResponse>;
}

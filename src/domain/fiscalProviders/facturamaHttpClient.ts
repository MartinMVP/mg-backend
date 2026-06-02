import { ProviderHttpClient, ProviderHttpRequest, ProviderHttpResponse } from './providerHttpClient.interface';
import { ProviderRuntimeError } from './providerRuntime.service';
import { mapFacturamaError, mapFacturamaHttpStatus } from './facturamaError.mapper';

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type FacturamaHttpClientOptions = {
  apiUrl: string;
  username?: string;
  password?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
};

function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function parseJsonOrText(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function authHeaders(options: FacturamaHttpClientOptions) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  } else if (options.username && options.password) {
    const encoded = Buffer.from(`${options.username}:${options.password}`).toString('base64');
    headers.Authorization = `Basic ${encoded}`;
  }

  return headers;
}

export class FacturamaHttpClient implements ProviderHttpClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: FacturamaHttpClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async post(
    path: string,
    body?: unknown,
    options?: Omit<ProviderHttpRequest, 'method' | 'path' | 'body'>
  ): Promise<ProviderHttpResponse> {
    return this.request({ method: 'POST', path, body, ...options });
  }

  async get(
    path: string,
    options?: Omit<ProviderHttpRequest, 'method' | 'path'>
  ): Promise<ProviderHttpResponse> {
    return this.request({ method: 'GET', path, ...options });
  }

  private async request(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    if (!this.options.apiUrl) {
      throw new ProviderRuntimeError('facturama_missing_api_url', 'Facturama API URL is not configured', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs || 10_000);

    try {
      const response = await this.fetchImpl(joinUrl(this.options.apiUrl, request.path), {
        method: request.method,
        headers: {
          ...authHeaders(this.options),
          ...(request.headers || {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsedBody = parseJsonOrText(text);
      const message = typeof parsedBody === 'object' && parsedBody && 'message' in parsedBody
        ? String((parsedBody as { message?: unknown }).message || '')
        : response.ok
          ? 'Facturama request succeeded'
          : 'Facturama request failed';

      if (!response.ok) {
        const mapped = mapFacturamaHttpStatus(response.status, message);
        throw new ProviderRuntimeError(mapped.code, mapped.message, mapped.retryable);
      }

      return {
        ok: true,
        status: response.status,
        body: parsedBody,
        message: message || 'Facturama request succeeded',
      };
    } catch (error) {
      throw mapFacturamaError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

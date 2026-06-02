import { ProviderHttpClient, ProviderHttpRequest, ProviderHttpResponse } from './providerHttpClient.interface';

export class SandboxHttpClientStub implements ProviderHttpClient {
  async post(
    _path: string,
    _body?: unknown,
    _options?: Omit<ProviderHttpRequest, 'method' | 'path' | 'body'>
  ): Promise<ProviderHttpResponse> {
    return this.notExecuted();
  }

  async get(
    _path: string,
    _options?: Omit<ProviderHttpRequest, 'method' | 'path'>
  ): Promise<ProviderHttpResponse> {
    return this.notExecuted();
  }

  private notExecuted(): ProviderHttpResponse {
    return {
      ok: false,
      status: 503,
      message: 'Sandbox HTTP client is a local stub and performs no external calls',
    };
  }
}

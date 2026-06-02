import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { getFiscalProviderConfig } from '../../domain/fiscalProviders/fiscalProvider.config';
import { validateFiscalProviderConfig } from '../../domain/fiscalProviders/fiscalProvider.validation';
import {
  evaluateProviderReadiness,
  resolveProviderConfiguration,
} from '../../domain/fiscalProviders/providerConfiguration.resolver';
import { getProviderCredentialContract } from '../../domain/fiscalProviders/providerCredentials.types';
import { normalizeProviderEnvironment } from '../../domain/fiscalProviders/providerEnvironment';
import { validateProviderSecretStructure } from '../../domain/fiscalProviders/providerSecret.validation';
import { resolveProviderSecretStatus } from '../../domain/fiscalProviders/providerSecret.resolver';
import {
  defaultProviderResilienceConfig,
  validateProviderResilienceConfig,
} from '../../domain/fiscalProviders/providerResilience.types';
import { PacAdapter } from '../../domain/fiscalProviders/pacAdapter.interface';
import { mapPacError } from '../../domain/fiscalProviders/pacError.mapper';
import {
  checkFiscalProviderHealth,
  getFiscalProviderCapabilities,
  listFiscalProviders,
  resolveFiscalProvider,
} from '../../domain/fiscalProviders/fiscalProvider.registry';
import { MockPacAdapter } from '../../domain/fiscalProviders/mockPacAdapter';
import { MockFiscalProvider } from '../../domain/fiscalProviders/mockFiscalProvider';
import { SandboxPacAdapter } from '../../domain/fiscalProviders/sandboxPacAdapter';
import { ProviderTrace } from '../../domain/fiscalProviders/providerTrace.model';
import { processInvoiceQueue } from '../../domain/invoiceProcessing/invoiceProcessor.service';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { InvoiceQueue } from '../../domain/invoiceQueue/invoiceQueue.model';
import { InvoiceRecord } from '../../domain/invoiceRecords/invoiceRecord.model';
import { Transaction } from '../../domain/transactions/transaction.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('admin fiscal invoice processing', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
    const user = await createTestUser(role);
    return createAccessToken(String(user._id), role);
  }

  async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
    const previous: Record<string, string | undefined> = {};

    for (const key of Object.keys(env)) {
      previous[key] = process.env[key];
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    }

    try {
      return await fn();
    } finally {
      for (const key of Object.keys(env)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  }

  async function createQueuedInvoice(status: 'queued' | 'processing' | 'completed' | 'cancelled' = 'queued') {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 8000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 8000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 8000,
      status: 'ready_for_invoice',
    });
    const snapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      buyerFiscalProfile: {
        rfc: 'XAXX010101000',
        razonSocial: 'Comprador Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
        emailFacturacion: 'buyer@mg.test',
      },
      sellerFiscalProfile: {
        rfc: 'XAXX010101000',
        razonSocial: 'Vendedor Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
        emailFacturacion: 'seller@mg.test',
      },
      amount: 8000,
      currency: 'MXN',
    });
    const draft = await InvoiceDraft.create({
      transactionId: transaction._id,
      fiscalSnapshotId: snapshot._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 8000,
      currency: 'MXN',
      status: 'ready',
      createdFromTransaction: true,
    });
    const queue = await InvoiceQueue.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      fiscalSnapshotId: snapshot._id,
      status,
      queuedAt: new Date(),
    });

    return { transaction, snapshot, draft, queue };
  }

  it('returns 401 without auth on process-next', async () => {
    const res = await request(app).post('/admin/fiscal/queue/process-next');

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user on process-next', async () => {
    const token = await authToken('user');

    const res = await request(app)
      .post('/admin/fiscal/queue/process-next')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('lists fiscal providers only for admin or super', async () => {
    const adminToken = await authToken('admin');
    const userToken = await authToken('user');

    const noAuth = await request(app).get('/admin/fiscal/providers');
    const user = await request(app)
      .get('/admin/fiscal/providers')
      .set('Authorization', bearer(userToken));
    const admin = await request(app)
      .get('/admin/fiscal/providers')
      .set('Authorization', bearer(adminToken));

    expect(noAuth.status).toBe(401);
    expect(user.status).toBe(403);
    expect(admin.status).toBe(200);
    expect(admin.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'mock', enabled: true, sandbox: true }),
      expect.objectContaining({ name: 'future-pac-1', enabled: false }),
      expect.objectContaining({ name: 'future-pac-2', enabled: false }),
      expect.objectContaining({ name: 'sandbox-pac', enabled: false, sandbox: true }),
    ]));
  });

  it('returns safe current fiscal provider config', async () => {
    const token = await authToken('super');

    const res = await request(app)
      .get('/admin/fiscal/providers/current')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('mock');
    expect(res.body.config).toMatchObject({
      provider: 'mock',
      environment: 'mock',
      enabled: true,
      sandbox: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|token|password/i);
  });

  it('resolves the default fiscal provider through registry', () => {
    const config = getFiscalProviderConfig({});
    const resolved = resolveFiscalProvider(config);
    const providers = listFiscalProviders();

    expect(config).toMatchObject({
      provider: 'mock',
      environment: 'mock',
      enabled: true,
      sandbox: true,
      timeoutMs: 10_000,
    });
    expect(resolved.provider.name).toBe('mock');
    expect(providers.map((provider) => provider.name)).toEqual(
      expect.arrayContaining(['mock', 'future-pac-1', 'future-pac-2', 'sandbox-pac'])
    );
  });

  it('exposes mock provider capabilities without real external integration', () => {
    const capabilities = getFiscalProviderCapabilities('mock');

    expect(capabilities).toMatchObject({
      provider: 'mock',
      enabled: true,
      capabilities: {
        validateInvoiceInput: true,
        issueInvoice: true,
        cancelInvoice: true,
        getInvoiceStatus: true,
        sandboxSupported: true,
        productionSupported: false,
        traceSupported: true,
        retrySupported: true,
      },
    });
  });

  it('keeps future providers disabled in capabilities', () => {
    const capabilities = getFiscalProviderCapabilities('future-pac-1');

    expect(capabilities).toMatchObject({
      provider: 'future-pac-1',
      enabled: false,
      capabilities: {
        issueInvoice: false,
        cancelInvoice: false,
        traceSupported: false,
      },
    });
  });

  it('returns mock provider health as healthy without external calls', async () => {
    const health = await checkFiscalProviderHealth('mock', getFiscalProviderConfig({}));

    expect(health).toMatchObject({
      ok: true,
      provider: 'mock',
      environment: 'mock',
      status: 'healthy',
    });
    expect(health?.checkedAt).toBeInstanceOf(Date);
  });

  it('returns disabled health for future provider', async () => {
    const health = await checkFiscalProviderHealth('future-pac-1', {
      ...getFiscalProviderConfig({}),
      provider: 'future-pac-1',
    });

    expect(health).toMatchObject({
      ok: false,
      provider: 'future-pac-1',
      status: 'disabled',
    });
  });

  it('exposes sandbox PAC placeholder as disabled and not default', () => {
    const providers = listFiscalProviders();
    const defaultConfig = getFiscalProviderConfig({});
    const sandbox = providers.find((provider) => provider.name === 'sandbox-pac');

    expect(defaultConfig.provider).toBe('mock');
    expect(sandbox).toMatchObject({
      name: 'sandbox-pac',
      enabled: false,
      sandbox: true,
      capabilities: {
        issueInvoice: true,
        cancelInvoice: true,
        getInvoiceStatus: true,
        sandboxSupported: true,
        productionSupported: false,
      },
    });
  });

  it('does not resolve sandbox PAC while it is disabled and has no factory', () => {
    expect(() => resolveFiscalProvider({
      ...getFiscalProviderConfig({}),
      provider: 'sandbox-pac',
      environment: 'sandbox',
      sandbox: true,
    })).toThrow('Unsupported fiscal provider: sandbox-pac');
  });

  it('returns clear sandbox readiness issues without exposing secrets', async () => {
    const readiness = await evaluateProviderReadiness({
      ...getFiscalProviderConfig({}),
      provider: 'sandbox-pac',
      environment: 'sandbox',
      sandbox: true,
      apiUrl: null,
      timeoutMs: 10_000,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      'provider_disabled',
      'provider_not_resolvable',
      'sandbox_provider_not_resolvable',
      'provider_health_disabled',
      'missing_sandbox_api_url',
      'sandbox_api_url_missing',
      'sandbox_credentials_missing',
    ]));
    expect(JSON.stringify(readiness)).not.toMatch(/password|apiKey-value|token|secret|certificate-value/i);
  });

  it('returns disabled sandbox health without network calls or traces', async () => {
    const tracesBefore = await ProviderTrace.countDocuments();
    const health = await checkFiscalProviderHealth('sandbox-pac', {
      ...getFiscalProviderConfig({}),
      provider: 'sandbox-pac',
      environment: 'sandbox',
      sandbox: true,
    });

    expect(health).toMatchObject({
      ok: false,
      provider: 'sandbox-pac',
      environment: 'sandbox',
      status: 'disabled',
    });
    expect(await ProviderTrace.countDocuments()).toBe(tracesBefore);
  });

  it('sandbox PAC adapter returns controlled errors without XML PDF UUID or external calls', async () => {
    const adapter = new SandboxPacAdapter();
    const issue = await adapter.issue({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
    });
    const cancel = await adapter.cancel({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
    });
    const status = await adapter.getStatus({
      transactionId: 'transaction-id',
      invoiceQueueId: 'queue-id',
    });

    expect(issue).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      error: { code: 'PAC_AUTH_ERROR', retryable: false },
    });
    expect(cancel).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      error: { code: 'PAC_AUTH_ERROR', retryable: false },
    });
    expect(status).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      error: { code: 'PAC_AUTH_ERROR', retryable: false },
    });
    expect(JSON.stringify({ issue, cancel, status })).not.toMatch(/xml|pdf|uuid|timbre|sello|certificado/i);
  });

  it('keeps sandbox PAC disabled by default while mock remains default', () => {
    const mockConfig = getFiscalProviderConfig({});
    const sandboxConfig = getFiscalProviderConfig({
      FISCAL_PROVIDER: 'sandbox-pac',
      FISCAL_PROVIDER_ENVIRONMENT: 'sandbox',
    });

    expect(mockConfig).toMatchObject({
      provider: 'mock',
      environment: 'mock',
      enabled: true,
    });
    expect(sandboxConfig).toMatchObject({
      provider: 'sandbox-pac',
      environment: 'sandbox',
      enabled: false,
      sandbox: true,
      apiUrl: null,
    });
  });

  it('fails sandbox readiness when enabled without apiUrl', async () => {
    const config = getFiscalProviderConfig({
      FISCAL_PROVIDER: 'sandbox-pac',
      FISCAL_PROVIDER_ENVIRONMENT: 'sandbox',
      FISCAL_PROVIDER_SANDBOX_ENABLED: 'true',
      FISCAL_PROVIDER_SANDBOX_API_KEY: 'present',
    });

    const readiness = await evaluateProviderReadiness(config);

    expect(config.enabled).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      'sandbox_api_url_missing',
      'missing_sandbox_api_url',
      'provider_disabled',
      'sandbox_provider_not_resolvable',
    ]));
    expect(JSON.stringify(readiness)).not.toMatch(/present|secret|password|token/i);
  });

  it('fails sandbox readiness when enabled without credential flags', async () => {
    const config = getFiscalProviderConfig({
      FISCAL_PROVIDER: 'sandbox-pac',
      FISCAL_PROVIDER_ENVIRONMENT: 'sandbox',
      FISCAL_PROVIDER_SANDBOX_ENABLED: 'true',
      FISCAL_PROVIDER_SANDBOX_API_URL: 'https://sandbox.invalid',
    });

    const readiness = await evaluateProviderReadiness(config);

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain('sandbox_credentials_missing');
    expect(JSON.stringify(readiness)).not.toContain('https://sandbox.invalid');
  });

  it('passes sandbox structural secret validation with simulated flags', () => {
    const config = getFiscalProviderConfig({
      FISCAL_PROVIDER: 'sandbox-pac',
      FISCAL_PROVIDER_ENVIRONMENT: 'sandbox',
      FISCAL_PROVIDER_SANDBOX_ENABLED: 'true',
      FISCAL_PROVIDER_SANDBOX_API_URL: 'https://sandbox.invalid',
      FISCAL_PROVIDER_SANDBOX_TIMEOUT_MS: '12000',
      FISCAL_PROVIDER_SANDBOX_API_KEY: 'fake-key-not-returned',
    });
    const secretStatus = resolveProviderSecretStatus({
      FISCAL_PROVIDER_SANDBOX_API_KEY: 'fake-key-not-returned',
    }, config);
    const validation = validateProviderSecretStructure(config, secretStatus.credentialShape);

    expect(secretStatus).toMatchObject({
      hasApiKey: true,
      hasCredentials: true,
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).not.toContain('sandbox_credentials_missing');
    expect(JSON.stringify({ secretStatus, validation })).not.toContain('fake-key-not-returned');
  });

  it('defines sandbox resilience and payload limit contracts without network behavior', () => {
    const valid = validateProviderResilienceConfig(defaultProviderResilienceConfig);
    const invalid = validateProviderResilienceConfig({
      ...defaultProviderResilienceConfig,
      timeoutMs: 1,
      maxProviderPayloadBytes: 10,
    });

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toEqual(expect.arrayContaining([
      'sandbox_timeout_invalid',
      'sandbox_payload_limit_invalid',
    ]));
  });

  it('validates current mock provider config', () => {
    const validation = validateFiscalProviderConfig(getFiscalProviderConfig({}));

    expect(validation).toEqual({
      valid: true,
      issues: [],
      provider: 'mock',
      environment: 'mock',
    });
  });

  it('fails config validation for disabled provider', () => {
    const validation = validateFiscalProviderConfig({
      ...getFiscalProviderConfig({}),
      provider: 'future-pac-1',
      environment: 'sandbox',
      sandbox: true,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain('provider_disabled');
  });

  it('protects provider readiness endpoints with auth and admin role', async () => {
    const adminToken = await authToken('admin');
    const userToken = await authToken('user');

    const noAuthCapabilities = await request(app).get('/admin/fiscal/providers/mock/capabilities');
    const userCapabilities = await request(app)
      .get('/admin/fiscal/providers/mock/capabilities')
      .set('Authorization', bearer(userToken));
    const adminCapabilities = await request(app)
      .get('/admin/fiscal/providers/mock/capabilities')
      .set('Authorization', bearer(adminToken));
    const userHealth = await request(app)
      .get('/admin/fiscal/providers/current/health')
      .set('Authorization', bearer(userToken));
    const userValidation = await request(app)
      .get('/admin/fiscal/providers/current/config-validation')
      .set('Authorization', bearer(userToken));

    expect(noAuthCapabilities.status).toBe(401);
    expect(userCapabilities.status).toBe(403);
    expect(userHealth.status).toBe(403);
    expect(userValidation.status).toBe(403);
    expect(adminCapabilities.status).toBe(200);
  });

  it('returns current provider health and config validation through read-only endpoints', async () => {
    const token = await authToken('super');

    const health = await request(app)
      .get('/admin/fiscal/providers/current/health')
      .set('Authorization', bearer(token));
    const validation = await request(app)
      .get('/admin/fiscal/providers/current/config-validation')
      .set('Authorization', bearer(token));
    const disabledHealth = await request(app)
      .get('/admin/fiscal/providers/future-pac-1/health')
      .set('Authorization', bearer(token));
    const sandboxCapabilities = await request(app)
      .get('/admin/fiscal/providers/sandbox-pac/capabilities')
      .set('Authorization', bearer(token));
    const sandboxHealth = await request(app)
      .get('/admin/fiscal/providers/sandbox-pac/health')
      .set('Authorization', bearer(token));

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, provider: 'mock', status: 'healthy' });
    expect(validation.status).toBe(200);
    expect(validation.body.validation).toMatchObject({ valid: true, provider: 'mock' });
    expect(JSON.stringify(validation.body)).not.toMatch(/secret|token|password/i);
    expect(disabledHealth.status).toBe(200);
    expect(disabledHealth.body).toMatchObject({ ok: false, provider: 'future-pac-1', status: 'disabled' });
    expect(sandboxCapabilities.status).toBe(200);
    expect(sandboxCapabilities.body).toMatchObject({
      provider: 'sandbox-pac',
      enabled: false,
      capabilities: { issueInvoice: true, sandboxSupported: true },
    });
    expect(sandboxHealth.status).toBe(200);
    expect(sandboxHealth.body).toMatchObject({ ok: false, provider: 'sandbox-pac', status: 'disabled' });
    expect(JSON.stringify({ sandboxCapabilities: sandboxCapabilities.body, sandboxHealth: sandboxHealth.body }))
      .not.toMatch(/secret|password|token|xml|pdf|uuid|timbre/i);
  });

  it('does not create ProviderTrace on provider readiness endpoints', async () => {
    const token = await authToken('admin');

    await request(app)
      .get('/admin/fiscal/providers/mock/capabilities')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/providers/mock/health')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/providers/current/config-validation')
      .set('Authorization', bearer(token));

    expect(await ProviderTrace.countDocuments()).toBe(0);
  });

  it('does not expose XML PDF or UUID in provider readiness endpoints', async () => {
    const token = await authToken('admin');

    const capabilities = await request(app)
      .get('/admin/fiscal/providers/mock/capabilities')
      .set('Authorization', bearer(token));
    const health = await request(app)
      .get('/admin/fiscal/providers/current/health')
      .set('Authorization', bearer(token));

    expect(JSON.stringify({ capabilities: capabilities.body, health: health.body })).not.toMatch(/xml|pdf|uuid|timbre/i);
  });

  it('normalizes provider environment without connecting real environments', () => {
    expect(normalizeProviderEnvironment('mock')).toBe('local');
    expect(normalizeProviderEnvironment('local')).toBe('local');
    expect(normalizeProviderEnvironment('sandbox')).toBe('sandbox');
    expect(normalizeProviderEnvironment('production')).toBe('production');
    expect(normalizeProviderEnvironment('unexpected')).toBeNull();
  });

  it('defines credential contracts without storing credential values', () => {
    const mockContract = getProviderCredentialContract('mock', 'mock');
    const futureContract = getProviderCredentialContract('future-pac-1', 'sandbox');

    expect(mockContract.requiredFields).toEqual([]);
    expect(mockContract.optionalFields).toEqual([]);
    expect(futureContract.requiredFields).toEqual(expect.arrayContaining(['apiKey', 'certificateReference']));
    expect(JSON.stringify({ mockContract, futureContract })).not.toMatch(/real|credential-value|token-value/i);
  });

  it('validates provider secret structure without reading real secrets', () => {
    const mockValidation = validateProviderSecretStructure(getFiscalProviderConfig({}));
    const invalidMockValidation = validateProviderSecretStructure(getFiscalProviderConfig({}), { apiKey: true });
    const futureValidation = validateProviderSecretStructure({
      ...getFiscalProviderConfig({}),
      provider: 'future-pac-1',
      environment: 'sandbox',
      sandbox: true,
    });

    expect(mockValidation.valid).toBe(true);
    expect(invalidMockValidation.valid).toBe(false);
    expect(invalidMockValidation.issues).toContain('mock_provider_must_not_receive_credentials');
    expect(futureValidation.valid).toBe(false);
    expect(futureValidation.issues).toEqual(expect.arrayContaining(['missing_apiKey', 'missing_certificateReference']));
  });

  it('resolves current provider configuration safely', () => {
    const resolved = resolveProviderConfiguration(getFiscalProviderConfig({}));

    expect(resolved).toMatchObject({
      provider: 'mock',
      environment: 'mock',
      normalizedEnvironment: 'local',
      enabled: true,
    });
    expect(resolved.capabilities).toMatchObject({ issueInvoice: true });
    expect(resolved.environmentRules).toMatchObject({
      environment: 'local',
      allowsExternalCalls: false,
      allowsRealCredentials: false,
    });
    expect(resolved.credentialContract).toEqual({
      provider: 'mock',
      environment: 'mock',
      requiredFieldCount: 0,
      optionalFieldCount: 0,
    });
    expect(JSON.stringify(resolved)).not.toMatch(/credential-value|token-value|password-value|real-secret/i);
  });

  it('evaluates mock provider readiness and disabled providers', async () => {
    const mockReadiness = await evaluateProviderReadiness(getFiscalProviderConfig({}));
    const disabledReadiness = await evaluateProviderReadiness({
      ...getFiscalProviderConfig({}),
      provider: 'future-pac-1',
      environment: 'sandbox',
      sandbox: true,
    });

    expect(mockReadiness).toEqual({
      ready: true,
      issues: [],
      provider: 'mock',
      environment: 'mock',
    });
    expect(disabledReadiness.ready).toBe(false);
    expect(disabledReadiness.issues).toEqual(expect.arrayContaining([
      'provider_disabled',
      'provider_health_disabled',
      'missing_apiKey',
      'missing_certificateReference',
    ]));
  });

  it('protects provider configuration lifecycle endpoints with auth and admin role', async () => {
    const adminToken = await authToken('admin');
    const userToken = await authToken('user');

    const noAuthConfig = await request(app).get('/admin/fiscal/providers/current/config');
    const userEnvironment = await request(app)
      .get('/admin/fiscal/providers/current/environment')
      .set('Authorization', bearer(userToken));
    const userReadiness = await request(app)
      .get('/admin/fiscal/providers/current/readiness')
      .set('Authorization', bearer(userToken));
    const adminConfig = await request(app)
      .get('/admin/fiscal/providers/current/config')
      .set('Authorization', bearer(adminToken));

    expect(noAuthConfig.status).toBe(401);
    expect(userEnvironment.status).toBe(403);
    expect(userReadiness.status).toBe(403);
    expect(adminConfig.status).toBe(200);
  });

  it('returns current provider configuration lifecycle through read-only endpoints', async () => {
    const token = await authToken('super');
    const tracesBefore = await ProviderTrace.countDocuments();

    const config = await request(app)
      .get('/admin/fiscal/providers/current/config')
      .set('Authorization', bearer(token));
    const environment = await request(app)
      .get('/admin/fiscal/providers/current/environment')
      .set('Authorization', bearer(token));
    const readiness = await request(app)
      .get('/admin/fiscal/providers/current/readiness')
      .set('Authorization', bearer(token));

    expect(config.status).toBe(200);
    expect(config.body.configuration).toMatchObject({
      provider: 'mock',
      normalizedEnvironment: 'local',
      enabled: true,
    });
    expect(environment.status).toBe(200);
    expect(environment.body).toMatchObject({
      provider: 'mock',
      environment: 'mock',
      normalizedEnvironment: 'local',
      rules: {
        allowsExternalCalls: false,
        allowsRealCredentials: false,
      },
    });
    expect(readiness.status).toBe(200);
    expect(readiness.body.readiness).toMatchObject({
      ready: true,
      provider: 'mock',
      environment: 'mock',
    });
    expect(JSON.stringify({ config: config.body, environment: environment.body, readiness: readiness.body }))
      .not.toMatch(/credential-value|token-value|password-value|real-secret|xml|pdf|uuid|timbre/i);
    expect(await ProviderTrace.countDocuments()).toBe(tracesBefore);
  });

  it('protects sandbox PAC readiness endpoints with auth and admin role', async () => {
    const adminToken = await authToken('admin');
    const superToken = await authToken('super');
    const userToken = await authToken('user');

    const noAuth = await request(app).get('/admin/fiscal/providers/sandbox-pac/config');
    const user = await request(app)
      .get('/admin/fiscal/providers/sandbox-pac/readiness')
      .set('Authorization', bearer(userToken));
    const admin = await request(app)
      .get('/admin/fiscal/providers/sandbox-pac/secrets-status')
      .set('Authorization', bearer(adminToken));
    const superRes = await request(app)
      .get('/admin/fiscal/providers/sandbox-pac/config')
      .set('Authorization', bearer(superToken));

    expect(noAuth.status).toBe(401);
    expect(user.status).toBe(403);
    expect(admin.status).toBe(200);
    expect(superRes.status).toBe(200);
  });

  it('returns sandbox PAC config readiness and secrets status without exposing secret values', async () => {
    await withEnv({
      FISCAL_PROVIDER_SANDBOX_ENABLED: 'true',
      FISCAL_PROVIDER_SANDBOX_API_URL: 'https://sandbox.invalid',
      FISCAL_PROVIDER_SANDBOX_TIMEOUT_MS: '12000',
      FISCAL_PROVIDER_SANDBOX_API_KEY: 'fake-key-not-returned',
      FISCAL_PROVIDER_SANDBOX_PASSWORD: 'fake-password-not-returned',
    }, async () => {
      const token = await authToken('admin');
      const tracesBefore = await ProviderTrace.countDocuments();

      const config = await request(app)
        .get('/admin/fiscal/providers/sandbox-pac/config')
        .set('Authorization', bearer(token));
      const readiness = await request(app)
        .get('/admin/fiscal/providers/sandbox-pac/readiness')
        .set('Authorization', bearer(token));
      const secrets = await request(app)
        .get('/admin/fiscal/providers/sandbox-pac/secrets-status')
        .set('Authorization', bearer(token));

      expect(config.status).toBe(200);
      expect(config.body).toMatchObject({
        provider: 'sandbox-pac',
        enabled: true,
        environment: 'sandbox',
        hasApiUrl: true,
        timeoutConfigured: true,
      });
      expect(config.body.configuration.safeConfig).toMatchObject({
        provider: 'sandbox-pac',
        hasApiUrl: true,
      });
      expect(config.body.configuration.safeConfig).not.toHaveProperty('apiUrl');
      expect(readiness.status).toBe(200);
      expect(readiness.body).toMatchObject({
        provider: 'sandbox-pac',
        enabled: true,
        hasCredentials: true,
        hasApiUrl: true,
      });
      expect(readiness.body.readiness.issues).toEqual(expect.arrayContaining([
        'provider_disabled',
        'sandbox_provider_not_resolvable',
      ]));
      expect(readiness.body.readiness.issues).not.toContain('sandbox_api_url_missing');
      expect(readiness.body.readiness.issues).not.toContain('sandbox_credentials_missing');
      expect(secrets.status).toBe(200);
      expect(secrets.body.secretsStatus).toMatchObject({
        hasApiKey: true,
        hasPassword: true,
        hasCredentials: true,
      });
      expect(JSON.stringify({ config: config.body, readiness: readiness.body, secrets: secrets.body }))
        .not.toMatch(/fake-key-not-returned|fake-password-not-returned|https:\/\/sandbox\.invalid|xml|pdf|uuid|timbre/i);
      expect(await ProviderTrace.countDocuments()).toBe(tracesBefore);
    });
  });

  it('compiles the PAC adapter contract with MockPacAdapter', () => {
    const adapter: PacAdapter = new MockPacAdapter();

    expect(adapter.name).toBe('mock-pac-adapter');
    expect(typeof adapter.issue).toBe('function');
    expect(typeof adapter.cancel).toBe('function');
    expect(typeof adapter.getStatus).toBe('function');
  });

  it('mock PAC adapter issues successfully without XML PDF or fiscal UUID', async () => {
    const adapter = new MockPacAdapter();
    const result = await adapter.issue({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
    });

    expect(result).toMatchObject({
      ok: true,
      providerStatus: 'issued',
      message: 'Mock invoice issued',
      providerReference: 'mock-queue-id',
      providerRequestId: 'mock-req-queue-id',
      simulatedExternalId: 'mock-queue-id',
    });
    expect(JSON.stringify(result)).not.toMatch(/xml|pdf|uuid|timbre|sello|certificado/i);
  });

  it('mock PAC adapter reports issue failure', async () => {
    const adapter = new MockPacAdapter({ issueShouldFail: true });
    const result = await adapter.issue({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
    });

    expect(result).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      message: 'Mock invoice issue failed',
      providerRequestId: 'mock-req-queue-id',
      error: {
        code: 'PAC_VALIDATION_ERROR',
        retryable: false,
      },
    });
  });

  it('mock PAC adapter cancels successfully and reports cancellation failure', async () => {
    const success = await new MockPacAdapter().cancel({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
      providerReference: 'mock-reference',
    });
    const failure = await new MockPacAdapter({ cancelShouldFail: true }).cancel({
      transactionId: 'transaction-id',
      invoiceDraftId: 'draft-id',
      invoiceQueueId: 'queue-id',
      providerReference: 'mock-reference',
    });

    expect(success).toMatchObject({
      ok: true,
      providerStatus: 'cancelled',
      message: 'Mock cancellation successful',
      providerReference: 'mock-reference',
    });
    expect(failure).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      message: 'Mock cancellation failed',
      error: { code: 'PAC_VALIDATION_ERROR', retryable: false },
    });
  });

  it('mock PAC adapter returns simulated status', async () => {
    const result = await new MockPacAdapter().getStatus({
      transactionId: 'transaction-id',
      invoiceQueueId: 'queue-id',
      providerReference: 'mock-reference',
    });

    expect(result).toMatchObject({
      ok: true,
      providerStatus: 'mock_status_available',
      message: 'Mock invoice status available',
      providerReference: 'mock-reference',
    });
  });

  it('maps PAC errors into retryable and non-retryable internal errors', () => {
    expect(mapPacError('PAC_TIMEOUT')).toMatchObject({
      code: 'PAC_TIMEOUT',
      retryable: true,
    });
    expect(mapPacError('PAC_AUTH_ERROR')).toMatchObject({
      code: 'PAC_AUTH_ERROR',
      retryable: false,
    });
  });

  it('MockFiscalProvider delegates invoice issuing to MockPacAdapter', async () => {
    const provider = new MockFiscalProvider({ pacAdapter: new MockPacAdapter() });
    const result = await provider.issueInvoice({
      transactionId: new Types.ObjectId(),
      invoiceDraftId: new Types.ObjectId(),
      invoiceQueueId: new Types.ObjectId('64f000000000000000000001'),
    });

    expect(result).toMatchObject({
      ok: true,
      providerStatus: 'issued',
      providerMessage: 'Mock invoice issued',
      providerReference: 'mock-64f000000000000000000001',
      providerRequestId: 'mock-req-64f000000000000000000001',
      simulatedExternalId: 'mock-64f000000000000000000001',
    });
  });

  it('allows admin to process next queued invoice operation', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post('/admin/fiscal/queue/process-next')
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue.status).toBe('completed');
    expect(String(res.body.invoiceQueue._id)).toBe(String(queue._id));
    expect(freshQueue?.status).toBe('completed');
  });

  it('allows super to process a specific queued invoice operation', async () => {
    const token = await authToken('super');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue.status).toBe('completed');
    expect(String(res.body.invoiceQueue._id)).toBe(String(queue._id));
  });

  it('does not process a queue that is not queued', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('completed');

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice queue is not queued' });
  });

  it('creates an invoice record and marks it completed', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(res.status).toBe(200);
    expect(record).toBeTruthy();
    expect(record?.status).toBe('completed');
    expect(record?.processedAt).toBeTruthy();
    expect(record?.providerName).toBe('mock');
    expect(record?.provider).toBe('mock');
    expect(record?.providerEnvironment).toBe('mock');
    expect(record?.providerReference).toBe(`mock-${String(queue._id)}`);
    expect(record?.providerRequestId).toBe(`mock-req-${String(queue._id)}`);
    expect(record?.providerStatus).toBe('issued');
    expect(record?.providerMessage).toBe('Mock invoice issued');
    expect(record?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
  });

  it('does not duplicate an invoice record', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const first = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await InvoiceRecord.countDocuments({ invoiceQueueId: queue._id })).toBe(1);
  });

  it('increments attempts when processing starts', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(res.status).toBe(200);
    expect(record?.attempts).toBe(1);
  });

  it('registers audit events for processing', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const actions = await Audit.find({
      action: {
        $in: [
          'INVOICE_QUEUE_CLAIMED',
          'INVOICE_PROCESSING_STARTED',
          'INVOICE_PROCESSING_COMPLETED',
        ],
      },
    }).distinct('action');
    const completedAudit = await Audit.findOne({ action: 'INVOICE_PROCESSING_COMPLETED' });
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(res.status).toBe(200);
    expect(actions).toEqual(expect.arrayContaining([
      'INVOICE_QUEUE_CLAIMED',
      'INVOICE_PROCESSING_STARTED',
      'INVOICE_PROCESSING_COMPLETED',
    ]));
    expect(String(completedAudit?.transactionId)).toBe(String(queue.transactionId));
    expect(String(completedAudit?.invoiceRecordId)).toBe(String(record?._id));
    expect(String(completedAudit?.invoiceQueueId)).toBe(String(queue._id));
  });

  it('marks record failed, resets queue, stores lastError, and audits failed when processing throws during audit', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('Audit unavailable'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const failedAudit = await Audit.findOne({ action: 'INVOICE_PROCESSING_FAILED' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Audit unavailable');
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Audit unavailable');
    expect(failedAudit).toBeTruthy();
    expect(String(failedAudit?.transactionId)).toBe(String(queue.transactionId));
    expect(String(failedAudit?.invoiceRecordId)).toBe(String(record?._id));
    expect(String(failedAudit?.invoiceQueueId)).toBe(String(queue._id));
  });

  it('marks record failed and resets queue when invoice record creation throws', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(InvoiceRecord, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Record unavailable'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const failedAudit = await Audit.findOne({ action: 'INVOICE_PROCESSING_FAILED' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Record unavailable');
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Record unavailable');
    expect(failedAudit).toBeTruthy();
  });

  it('cleans lastError on retry after a failed processing attempt', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(InvoiceRecord, 'findOneAndUpdate').mockRejectedValueOnce(new Error('First attempt failed'));

    const first = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id }).lean();
    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    expect(freshQueue?.status).toBe('completed');
    expect(record?.status).toBe('completed');
    expect(record?.attempts).toBe(2);
    expect(record?.lastError).toBeUndefined();
  });

  it('lists invoice records', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const res = await request(app)
      .get('/admin/fiscal/invoice-records?status=completed')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe('completed');
  });

  it('returns invoice record detail', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record?._id}`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(record?._id));
    expect(res.body.status).toBe('completed');
  });

  it('returns 400 for invalid ids', async () => {
    const token = await authToken('admin');

    const processRes = await request(app)
      .post('/admin/fiscal/queue/not-an-object-id/process')
      .set('Authorization', bearer(token));
    const detailRes = await request(app)
      .get('/admin/fiscal/invoice-records/not-an-object-id')
      .set('Authorization', bearer(token));

    expect(processRes.status).toBe(400);
    expect(detailRes.status).toBe(400);
  });

  it('returns 404 for missing invoice queue and invoice record', async () => {
    const token = await authToken('admin');
    const missingId = new Types.ObjectId();

    const processRes = await request(app)
      .post(`/admin/fiscal/queue/${missingId}/process`)
      .set('Authorization', bearer(token));
    const detailRes = await request(app)
      .get(`/admin/fiscal/invoice-records/${new Types.ObjectId()}`)
      .set('Authorization', bearer(token));

    expect(processRes.status).toBe(404);
    expect(processRes.body).toEqual({ error: 'Not found' });
    expect(detailRes.status).toBe(404);
    expect(detailRes.body).toEqual({ error: 'Not found' });
  });

  it('protects invoice processing operation endpoints', async () => {
    const token = await authToken('user');
    const { queue } = await createQueuedInvoice();
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'Retryable',
    });

    const noAuth = await request(app).post(`/admin/fiscal/invoice-records/${record._id}/retry`);
    const userRetry = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));
    const userCancel = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const userRecover = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userRetry.status).toBe(403);
    expect(userCancel.status).toBe(403);
    expect(userRecover.status).toBe(403);
  });

  it('allows retry only for failed records', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record?._id}/retry`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record is not failed' });
  });

  it('retries a failed record without duplicating records or incrementing attempts', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Temporary failure',
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_PROCESSING_RETRY_REQUESTED' });

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('queued');
    expect(freshRecord?.attempts).toBe(2);
    expect(freshRecord?.lastError).toBeUndefined();
    expect(await InvoiceRecord.countDocuments({ invoiceQueueId: queue._id })).toBe(1);
    expect(audit).toBeTruthy();
  });

  it('does not increment retry attempts until processing runs again', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'Retryable',
    });

    const retry = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));
    const afterRetry = await InvoiceRecord.findById(record._id).lean();
    const process = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const afterProcess = await InvoiceRecord.findById(record._id).lean();

    expect(retry.status).toBe(200);
    expect(afterRetry?.attempts).toBe(1);
    expect(process.status).toBe(200);
    expect(afterProcess?.attempts).toBe(2);
  });

  it('cancels a queued invoice queue', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const audit = await Audit.findOne({ action: 'INVOICE_QUEUE_CANCELLED' });

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('cancelled');
    expect(audit).toBeTruthy();
  });

  it('cancels a processing invoice queue and marks its record failed', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'processing',
      attempts: 1,
    });

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const freshRecord = await InvoiceRecord.findById(record._id);

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('cancelled');
    expect(freshRecord?.status).toBe('failed');
    expect(freshRecord?.lastError).toBe('Cancelled by admin');
  });

  it('does not cancel a completed invoice queue', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('completed');

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice queue cannot be cancelled' });
  });

  it('recovers old processing queues without processing them', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    await InvoiceQueue.collection.updateOne(
      { _id: queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const audit = await Audit.findOne({ action: 'INVOICE_QUEUE_RECOVERED' });

    expect(res.status).toBe(200);
    expect(res.body.recoveredCount).toBe(1);
    expect(freshQueue?.status).toBe('queued');
    expect(audit).toBeTruthy();
  });

  it('does not recover recent processing queues', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');

    const res = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(res.status).toBe(200);
    expect(res.body.recoveredCount).toBe(0);
    expect(freshQueue?.status).toBe('processing');
  });

  it('cancels the queue when max processing attempts is reached', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Previous failure',
    });
    vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('Final failure'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const actions = await Audit.find({
      action: {
        $in: [
          'INVOICE_PROCESSING_FAILED',
          'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED',
        ],
      },
    }).distinct('action');

    expect(res.status).toBe(500);
    expect(freshQueue?.status).toBe('cancelled');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(3);
    expect(record?.lastError).toBe('Final failure');
    expect(actions).toEqual(expect.arrayContaining([
      'INVOICE_PROCESSING_FAILED',
      'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED',
    ]));
  });

  it('protects processing monitoring endpoints', async () => {
    const token = await authToken('user');

    const noAuth = await request(app).get('/admin/fiscal/processing/summary');
    const userSummary = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));
    const userFailures = await request(app)
      .get('/admin/fiscal/processing/failures')
      .set('Authorization', bearer(token));
    const userStuck = await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userSummary.status).toBe(403);
    expect(userFailures.status).toBe(403);
    expect(userStuck.status).toBe(403);
  });

  it('allows admin and super to read processing summary', async () => {
    const adminToken = await authToken('admin');
    const superToken = await authToken('super');

    const adminRes = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(adminToken));
    const superRes = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(superToken));

    expect(adminRes.status).toBe(200);
    expect(superRes.status).toBe(200);
  });

  it('summarizes invoice queue and invoice record status counts', async () => {
    const token = await authToken('admin');
    const queued = await createQueuedInvoice('queued');
    const processing = await createQueuedInvoice('processing');
    const completed = await createQueuedInvoice('completed');
    const cancelled = await createQueuedInvoice('cancelled');
    await InvoiceRecord.create({
      transactionId: queued.transaction._id,
      invoiceDraftId: queued.draft._id,
      invoiceQueueId: queued.queue._id,
      status: 'created',
      attempts: 0,
    });
    await InvoiceRecord.create({
      transactionId: processing.transaction._id,
      invoiceDraftId: processing.draft._id,
      invoiceQueueId: processing.queue._id,
      status: 'processing',
      attempts: 1,
    });
    await InvoiceRecord.create({
      transactionId: completed.transaction._id,
      invoiceDraftId: completed.draft._id,
      invoiceQueueId: completed.queue._id,
      status: 'completed',
      attempts: 2,
      processedAt: new Date(),
    });
    await InvoiceRecord.create({
      transactionId: cancelled.transaction._id,
      invoiceDraftId: cancelled.draft._id,
      invoiceQueueId: cancelled.queue._id,
      status: 'failed',
      attempts: 3,
      lastError: 'Failed',
    });
    await InvoiceQueue.collection.updateOne(
      { _id: processing.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue).toMatchObject({
      queued: 1,
      processing: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(res.body.invoiceRecord).toMatchObject({
      created: 1,
      processing: 1,
      completed: 1,
      failed: 1,
    });
    expect(res.body.totalAttempts).toBe(6);
    expect(res.body.failedRecords).toBe(1);
    expect(res.body.queuesStuckProcessing).toBe(1);
    expect(res.body.oldestQueuedAt).toBeTruthy();
    expect(res.body.latestProcessedAt).toBeTruthy();
  });

  it('lists only failed invoice records with pagination', async () => {
    const token = await authToken('admin');
    const first = await createQueuedInvoice('processing');
    const second = await createQueuedInvoice('processing');
    const third = await createQueuedInvoice('processing');
    await InvoiceRecord.create({
      transactionId: first.transaction._id,
      invoiceDraftId: first.draft._id,
      invoiceQueueId: first.queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'First',
    });
    await InvoiceRecord.create({
      transactionId: second.transaction._id,
      invoiceDraftId: second.draft._id,
      invoiceQueueId: second.queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Second',
    });
    await InvoiceRecord.create({
      transactionId: third.transaction._id,
      invoiceDraftId: third.draft._id,
      invoiceQueueId: third.queue._id,
      status: 'completed',
      attempts: 1,
    });

    const res = await request(app)
      .get('/admin/fiscal/processing/failures?page=1&limit=1')
      .set('Authorization', bearer(token));
    const secondPage = await request(app)
      .get('/admin/fiscal/processing/failures?page=2&limit=1')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].invoiceRecord.status).toBe('failed');
    expect(res.body.items[0].invoiceQueue).toBeTruthy();
    expect(res.body.items[0].transactionId).toBeTruthy();
    expect(res.body.items[0].attempts).toBeGreaterThan(0);
    expect(res.body.items[0].lastError).toBeTruthy();
    expect(res.body.items[0].updatedAt).toBeTruthy();
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].invoiceRecord.status).toBe('failed');
  });

  it('lists only old processing queues as stuck', async () => {
    const token = await authToken('admin');
    const oldProcessing = await createQueuedInvoice('processing');
    const recentProcessing = await createQueuedInvoice('processing');
    const queued = await createQueuedInvoice('queued');
    await InvoiceQueue.collection.updateOne(
      { _id: oldProcessing.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );
    await InvoiceQueue.collection.updateOne(
      { _id: recentProcessing.queue._id },
      { $set: { updatedAt: new Date() } }
    );
    await InvoiceQueue.collection.updateOne(
      { _id: queued.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]._id).toBe(String(oldProcessing.queue._id));
    expect(res.body.items[0].status).toBe('processing');
  });

  it('does not modify queues or records when reading monitoring endpoints', async () => {
    const token = await authToken('admin');
    const { queue, transaction, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Still failed',
    });
    await InvoiceQueue.collection.updateOne(
      { _id: queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const beforeQueue = await InvoiceQueue.findById(queue._id).lean();
    const beforeRecord = await InvoiceRecord.findById(record._id).lean();

    await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/processing/failures')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    const afterQueue = await InvoiceQueue.findById(queue._id).lean();
    const afterRecord = await InvoiceRecord.findById(record._id).lean();

    expect(afterQueue?.status).toBe(beforeQueue?.status);
    expect(afterQueue?.processedAt).toEqual(beforeQueue?.processedAt);
    expect(afterRecord?.status).toBe(beforeRecord?.status);
    expect(afterRecord?.attempts).toBe(beforeRecord?.attempts);
    expect(afterRecord?.lastError).toBe(beforeRecord?.lastError);
  });

  it('protects processing history and analytics endpoints', async () => {
    const token = await authToken('user');
    const { transaction, queue, draft } = await createQueuedInvoice();
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
    });

    const noAuth = await request(app).get(`/admin/fiscal/transactions/${transaction._id}/history`);
    const userTransactionHistory = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));
    const userRecordHistory = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));
    const userAnalytics = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userTransactionHistory.status).toBe(403);
    expect(userRecordHistory.status).toBe(403);
    expect(userAnalytics.status).toBe(403);
  });

  it('allows admin and super to read processing analytics', async () => {
    const adminToken = await authToken('admin');
    const superToken = await authToken('super');

    const adminRes = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(adminToken));
    const superRes = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(superToken));

    expect(adminRes.status).toBe(200);
    expect(superRes.status).toBe(200);
  });

  it('returns complete fiscal history for a transaction', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft, snapshot } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });
    await Audit.create({ actor: 'system', action: 'INVOICE_PROCESSING_COMPLETED' });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.transaction._id).toBe(String(transaction._id));
    expect(res.body.fiscalSnapshot._id).toBe(String(snapshot._id));
    expect(res.body.invoiceDraft._id).toBe(String(draft._id));
    expect(res.body.invoiceQueues.map((item: any) => item._id)).toContain(String(queue._id));
    expect(res.body.invoiceRecords.map((item: any) => item._id)).toContain(String(record._id));
    expect(res.body.auditEvents.map((event: any) => event.action)).toContain('INVOICE_PROCESSING_COMPLETED');
  });

  it('returns complete fiscal history for an invoice record', async () => {
    const token = await authToken('super');
    const { transaction, queue, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Failed',
    });
    await Audit.create({ actor: 'system', action: 'INVOICE_PROCESSING_FAILED' });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceRecord._id).toBe(String(record._id));
    expect(res.body.invoiceQueue._id).toBe(String(queue._id));
    expect(res.body.transaction._id).toBe(String(transaction._id));
    expect(res.body.auditEvents.map((event: any) => event.action)).toContain('INVOICE_PROCESSING_FAILED');
  });

  it('returns processing analytics with correct counts and rates', async () => {
    const token = await authToken('admin');
    const queued = await createQueuedInvoice('queued');
    const processing = await createQueuedInvoice('processing');
    const completed = await createQueuedInvoice('completed');
    const cancelled = await createQueuedInvoice('cancelled');
    await InvoiceRecord.create({
      transactionId: queued.transaction._id,
      invoiceDraftId: queued.draft._id,
      invoiceQueueId: queued.queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });
    await InvoiceRecord.create({
      transactionId: processing.transaction._id,
      invoiceDraftId: processing.draft._id,
      invoiceQueueId: processing.queue._id,
      status: 'completed',
      attempts: 2,
      processedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
    });
    await InvoiceRecord.create({
      transactionId: completed.transaction._id,
      invoiceDraftId: completed.draft._id,
      invoiceQueueId: completed.queue._id,
      status: 'failed',
      attempts: 3,
      lastError: 'Failed',
    });
    await InvoiceRecord.create({
      transactionId: cancelled.transaction._id,
      invoiceDraftId: cancelled.draft._id,
      invoiceQueueId: cancelled.queue._id,
      status: 'processing',
      attempts: 4,
    });

    const res = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue).toMatchObject({
      total: 4,
      queued: 1,
      processing: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(res.body.invoiceRecord).toMatchObject({
      total: 4,
      completed: 2,
      failed: 1,
    });
    expect(res.body.successRate).toBe(50);
    expect(res.body.failureRate).toBe(25);
    expect(res.body.averageAttempts).toBe(2.5);
    expect(res.body.maxAttemptsObserved).toBe(4);
    expect(res.body.processedLast24h).toBe(1);
    expect(res.body.processedLast7d).toBe(2);
    expect(res.body.processedLast30d).toBe(2);
  });

  it('does not modify documents when reading history and analytics endpoints', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Still failed',
    });
    const beforeTransaction = await Transaction.findById(transaction._id).lean();
    const beforeQueue = await InvoiceQueue.findById(queue._id).lean();
    const beforeRecord = await InvoiceRecord.findById(record._id).lean();

    await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));
    await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    const afterTransaction = await Transaction.findById(transaction._id).lean();
    const afterQueue = await InvoiceQueue.findById(queue._id).lean();
    const afterRecord = await InvoiceRecord.findById(record._id).lean();

    expect(afterTransaction?.status).toBe(beforeTransaction?.status);
    expect(afterQueue?.status).toBe(beforeQueue?.status);
    expect(afterQueue?.processedAt).toEqual(beforeQueue?.processedAt);
    expect(afterRecord?.status).toBe(beforeRecord?.status);
    expect(afterRecord?.attempts).toBe(beforeRecord?.attempts);
    expect(afterRecord?.lastError).toBe(beforeRecord?.lastError);
  });

  it('mock fiscal provider validates, issues, and cancels without real fiscal artifacts', async () => {
    const { transaction, queue, draft } = await createQueuedInvoice();
    const provider = new MockFiscalProvider();
    const input = {
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
    };

    const validation = await provider.validateInvoiceInput(input);
    const issue = await provider.issueInvoice(input);
    const cancellation = await provider.cancelInvoice(input);

    expect(validation).toEqual({ ok: true, message: 'Mock validation successful' });
    expect(issue).toMatchObject({
      ok: true,
      providerStatus: 'issued',
      providerMessage: 'Mock invoice issued',
      simulatedExternalId: `mock-${String(queue._id)}`,
    });
    expect(cancellation).toMatchObject({
      ok: true,
      providerStatus: 'cancelled',
      providerMessage: 'Mock cancellation successful',
      providerReference: `mock-${String(queue._id)}`,
      providerRequestId: `mock-cancel-${String(queue._id)}`,
    });
    expect(JSON.stringify(issue)).not.toContain('xml');
    expect(JSON.stringify(issue)).not.toContain('pdf');
    expect(issue.simulatedExternalId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('mock fiscal provider can return a controlled issue failure', async () => {
    const { transaction, queue, draft } = await createQueuedInvoice();
    const provider = new MockFiscalProvider({ issueShouldFail: true });

    const issue = await provider.issueInvoice({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
    });

    expect(issue).toMatchObject({
      ok: false,
      providerStatus: 'failed',
      providerMessage: 'Mock invoice issue failed',
      providerRequestId: `mock-req-${String(queue._id)}`,
    });
  });

  it('invoice processor stores provider metadata through registry/factory', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
    });
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id }).lean();

    expect(result.ok).toBe(true);
    expect(record?.provider).toBe('mock');
    expect(record?.providerEnvironment).toBe('mock');
    expect(record?.providerReference).toBe(`mock-${String(queue._id)}`);
    expect(record?.providerRequestId).toBe(`mock-req-${String(queue._id)}`);
    expect(record?.providerName).toBe('mock');
    expect(record?.providerStatus).toBe('issued');
    expect(record?.providerMessage).toBe('Mock invoice issued');
    expect(record?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
    expect(record).not.toHaveProperty('xml');
    expect(record).not.toHaveProperty('pdf');
    expect(record?.simulatedExternalId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('provider failure leaves queue retryable before max attempts', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(false);
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Mock invoice issue failed');
    expect(record?.providerName).toBe('mock');
    expect(record?.provider).toBe('mock');
    expect(record?.providerEnvironment).toBe('mock');
    expect(record?.providerStatus).toBe('failed');
    expect(record?.providerMessage).toBe('Mock invoice issue failed');
  });

  it('provider failure cancels queue when max attempts is reached', async () => {
    const { queue } = await createQueuedInvoice();
    await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Previous provider failure',
    });

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(false);
    expect(freshQueue?.status).toBe('cancelled');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(3);
    expect(record?.lastError).toBe('Mock invoice issue failed');
    expect(record?.providerStatus).toBe('failed');
  });

  it('issues a completed invoice record through the mock lifecycle', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_ISSUED' });

    expect(res.status).toBe(200);
    expect(freshRecord?.lifecycleStatus).toBe('issued');
    expect(freshRecord?.issuedAt).toBeTruthy();
    expect(freshRecord?.providerName).toBe('mock');
    expect(freshRecord?.provider).toBe('mock');
    expect(freshRecord?.providerEnvironment).toBe('mock');
    expect(freshRecord?.providerReference).toBe(`mock-${String(queue._id)}`);
    expect(freshRecord?.providerRequestId).toBe(`mock-req-${String(queue._id)}`);
    expect(freshRecord?.providerStatus).toBe('issued');
    expect(freshRecord?.providerMessage).toBe('Mock invoice issued');
    expect(freshRecord?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
    expect(audit).toBeTruthy();
    expect(String(audit?.transactionId)).toBe(String(transaction._id));
    expect(String(audit?.invoiceRecordId)).toBe(String(record._id));
    expect(String(audit?.invoiceQueueId)).toBe(String(queue._id));
  });

  it('claims issuing before provider call and blocks concurrent issue requests', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });

    const responses = await Promise.all([
      request(app)
        .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
        .set('Authorization', bearer(token)),
      request(app)
        .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
        .set('Authorization', bearer(token)),
    ]);
    const statuses = responses.map((res) => res.status).sort();
    const freshRecord = await InvoiceRecord.findById(record._id).lean();

    expect(statuses).toEqual([200, 409]);
    expect(freshRecord?.lifecycleStatus).toBe('issued');
    expect(await Audit.countDocuments({ action: 'INVOICE_ISSUED', invoiceRecordId: record._id })).toBe(1);
  });

  it('blocks duplicate invoice record issue', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record already issued' });
  });

  it('cancels an issued invoice record through the mock lifecycle', async () => {
    const token = await authToken('super');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_CANCELLED' });

    expect(res.status).toBe(200);
    expect(freshRecord?.lifecycleStatus).toBe('cancelled');
    expect(freshRecord?.cancelledAt).toBeTruthy();
    expect(freshRecord?.providerName).toBe('mock');
    expect(freshRecord?.provider).toBe('mock');
    expect(freshRecord?.providerEnvironment).toBe('mock');
    expect(freshRecord?.providerReference).toBe(`mock-${String(queue._id)}`);
    expect(freshRecord?.providerRequestId).toBe(`mock-cancel-${String(queue._id)}`);
    expect(freshRecord?.providerStatus).toBe('cancelled');
    expect(freshRecord?.providerMessage).toBe('Mock cancellation successful');
    expect(audit).toBeTruthy();
    expect(String(audit?.transactionId)).toBe(String(transaction._id));
    expect(String(audit?.invoiceRecordId)).toBe(String(record._id));
    expect(String(audit?.invoiceQueueId)).toBe(String(queue._id));
  });

  it('claims cancelling before provider call and blocks concurrent cancel requests', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const responses = await Promise.all([
      request(app)
        .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
        .set('Authorization', bearer(token)),
      request(app)
        .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
        .set('Authorization', bearer(token)),
    ]);
    const statuses = responses.map((res) => res.status).sort();
    const freshRecord = await InvoiceRecord.findById(record._id).lean();

    expect(statuses).toEqual([200, 409]);
    expect(freshRecord?.lifecycleStatus).toBe('cancelled');
    expect(await Audit.countDocuments({ action: 'INVOICE_CANCELLED', invoiceRecordId: record._id })).toBe(1);
  });

  it('blocks duplicate invoice record cancellation', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'cancelled',
      issuedAt: new Date(),
      cancelledAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record already cancelled' });
  });

  it('protects invoice record lifecycle endpoints', async () => {
    const token = await authToken('user');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
    });

    const noAuthIssue = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`);
    const userIssue = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));
    const userCancel = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(noAuthIssue.status).toBe(401);
    expect(userIssue.status).toBe(403);
    expect(userCancel.status).toBe(403);
  });

  it('returns lifecycle status in invoice record history', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceRecord.lifecycleStatus).toBe('issued');
    expect(res.body.invoiceRecord.issuedAt).toBeTruthy();
  });

  it('uses direct audit references in invoice record history', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const other = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });
    await Audit.create({
      actor: 'system',
      action: 'INVOICE_ISSUED',
      transactionId: transaction._id,
      invoiceRecordId: record._id,
      invoiceQueueId: queue._id,
    });
    await Audit.create({
      actor: 'system',
      action: 'INVOICE_ISSUED',
      transactionId: other.transaction._id,
      invoiceQueueId: other.queue._id,
    });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.auditEvents.map((event: any) => String(event.invoiceRecordId))).toContain(String(record._id));
    expect(res.body.auditEvents.map((event: any) => String(event.invoiceQueueId))).not.toContain(String(other.queue._id));
  });

  it('creates provider traces when processing mock provider successfully', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(true);
    const traces = await ProviderTrace.find({ invoiceQueueId: queue._id }).sort({ operation: 1 }).lean();
    expect(traces).toHaveLength(2);
    expect(traces.map((trace) => trace.operation)).toEqual(expect.arrayContaining(['validate', 'issue']));
    expect(traces.every((trace) => trace.status === 'success')).toBe(true);
    expect(traces.every((trace) => typeof trace.durationMs === 'number')).toBe(true);
    expect(traces.every((trace) => trace.providerName === 'mock')).toBe(true);
    expect(traces.every((trace) => trace.attempt === 1)).toBe(true);
  });

  it('stores failed provider trace when mock provider returns a controlled failure', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });

    expect(result.ok).toBe(false);
    const issueTrace = await ProviderTrace.findOne({ invoiceQueueId: queue._id, operation: 'issue' }).lean();
    expect(issueTrace?.status).toBe('failed');
    expect(issueTrace?.errorMessage).toBe('Mock invoice issue failed');
    expect(issueTrace?.durationMs).toEqual(expect.any(Number));
  });

  it('sanitizes provider trace request and response payloads', async () => {
    const { queue } = await createQueuedInvoice();

    await processInvoiceQueue({ invoiceQueueId: queue._id });

    const issueTrace = await ProviderTrace.findOne({ invoiceQueueId: queue._id, operation: 'issue' }).lean();
    const serialized = JSON.stringify({
      requestPayload: issueTrace?.requestPayload,
      responsePayload: issueTrace?.responsePayload,
    });

    expect(serialized).not.toMatch(/credential|password|secret|token|apiKey|authorization/i);
    expect(serialized).not.toMatch(/xml|pdf|uuid|sello|certificado|cadena|timbre/i);
  });

  it('protects provider trace list and detail endpoints', async () => {
    const adminToken = await authToken('admin');
    const userToken = await authToken('user');
    const { queue } = await createQueuedInvoice();
    await processInvoiceQueue({ invoiceQueueId: queue._id });
    const trace = await ProviderTrace.findOne({ invoiceQueueId: queue._id }).lean();

    const noAuthList = await request(app).get('/admin/fiscal/provider-traces');
    const userList = await request(app)
      .get('/admin/fiscal/provider-traces')
      .set('Authorization', bearer(userToken));
    const noAuthDetail = await request(app).get(`/admin/fiscal/provider-traces/${trace?._id}`);
    const adminDetail = await request(app)
      .get(`/admin/fiscal/provider-traces/${trace?._id}`)
      .set('Authorization', bearer(adminToken));

    expect(noAuthList.status).toBe(401);
    expect(userList.status).toBe(403);
    expect(noAuthDetail.status).toBe(401);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body._id).toBe(String(trace?._id));
  });

  it('filters and paginates provider traces', async () => {
    const token = await authToken('super');
    const first = await createQueuedInvoice();
    const second = await createQueuedInvoice();
    await processInvoiceQueue({ invoiceQueueId: first.queue._id });
    await processInvoiceQueue({
      invoiceQueueId: second.queue._id,
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });

    const failed = await request(app)
      .get('/admin/fiscal/provider-traces?operation=issue&status=success&page=1&limit=1')
      .set('Authorization', bearer(token));
    const byQueue = await request(app)
      .get(`/admin/fiscal/provider-traces?invoiceQueueId=${first.queue._id}`)
      .set('Authorization', bearer(token));

    expect(failed.status).toBe(200);
    expect(failed.body.page).toBe(1);
    expect(failed.body.limit).toBe(1);
    expect(failed.body.items).toHaveLength(1);
    expect(failed.body.items[0].operation).toBe('issue');
    expect(failed.body.items[0].status).toBe('success');
    expect(byQueue.status).toBe(200);
    expect(byQueue.body.items.every((item: any) => item.invoiceQueueId === String(first.queue._id))).toBe(true);
  });

  it('keeps provider trace endpoints read-only', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await processInvoiceQueue({ invoiceQueueId: queue._id });
    const trace = await ProviderTrace.findOne({ invoiceQueueId: queue._id }).lean();
    const before = await ProviderTrace.findById(trace?._id).lean();

    await request(app)
      .get('/admin/fiscal/provider-traces')
      .set('Authorization', bearer(token));
    await request(app)
      .get(`/admin/fiscal/provider-traces/${trace?._id}`)
      .set('Authorization', bearer(token));

    const after = await ProviderTrace.findById(trace?._id).lean();
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  });
});

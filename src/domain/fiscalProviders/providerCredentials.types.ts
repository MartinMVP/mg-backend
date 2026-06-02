export type ProviderCredentialField =
  | 'username'
  | 'password'
  | 'apiKey'
  | 'token'
  | 'certificateReference';

export type ProviderCredentialContract = {
  provider: string;
  environment: string;
  requiredFields: ProviderCredentialField[];
  optionalFields: ProviderCredentialField[];
};

export type ProviderCredentialShape = Partial<Record<ProviderCredentialField, boolean>>;

const emptyContract = (provider: string, environment: string): ProviderCredentialContract => ({
  provider,
  environment,
  requiredFields: [],
  optionalFields: [],
});

export function getProviderCredentialContract(provider: string, environment: string): ProviderCredentialContract {
  if (provider === 'mock') return emptyContract(provider, environment);

  if (provider === 'future-pac-1' || provider === 'future-pac-2') {
    return {
      provider,
      environment,
      requiredFields: ['apiKey', 'certificateReference'],
      optionalFields: ['username', 'token'],
    };
  }

  return emptyContract(provider, environment);
}

export function toSafeCredentialContract(contract: ProviderCredentialContract) {
  return {
    provider: contract.provider,
    environment: contract.environment,
    requiredFieldCount: contract.requiredFields.length,
    optionalFieldCount: contract.optionalFields.length,
  };
}

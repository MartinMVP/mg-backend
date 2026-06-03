export const fiscalOperationTypes = [
  'cattle_sale',
  'platform_commission',
  'auction_service',
  'premium_listing',
  'administrative_service',
] as const;

export type FiscalOperationType = typeof fiscalOperationTypes[number];

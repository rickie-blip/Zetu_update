export interface ShopifyConfig {
  shopName: string;
  accessToken: string;
  apiVersion: string;
  defaultLocationName: string;
}

export interface AppConfig {
  port: number;
  openUiOnStart: boolean;
  batchSize: number;
  batchDelayMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  shopify: ShopifyConfig;
}

// Runtime configuration.

export const APP_CONFIG: AppConfig = {
  port: 3000,
  openUiOnStart: true,
  batchSize: 10,
  batchDelayMs: 500,
  maxRetries: 5,
  retryBaseDelayMs: 1000,
  shopify: {
    shopName: 'your shop name',
    accessToken: 'shopify access token',
    apiVersion: '2023-01',
    defaultLocationName: '',
  },
};

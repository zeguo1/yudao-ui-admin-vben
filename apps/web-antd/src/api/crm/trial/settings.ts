import { requestClient } from '#/api/request';

export interface SettingsInput {
  revision: number;
  enabled: boolean;
  connectorEnabled: boolean;
  smsEnabled: boolean;
  environment: string;
  publicBaseUrl: string;
  mgsLoginUrl: string;
  knowdoBaseUrl: string;
  ownerUserId?: number;
  durationDays?: number;
  maxApplications?: number;
  oauthClientId: string;
  outboundKeyId: string;
  outboundSecret: string;
  smsTemplateCode: string;
  codeTtlSeconds: number;
  proofTtlSeconds: number;
  resendSeconds: number;
  maxAttempts: number;
  maxPerMobilePerDay: number;
  maxPerIdentityPerDay: number;
  maxTotalPerDay: number;
  issuer: string;
  assistantIds: string[];
  audiences: string[];
  channels: string[];
}
export type KeyKind = 'CARD' | 'PRIVATE_HMAC' | 'TOOLS';
export interface ServiceKey {
  id: string;
  kind: KeyKind;
  enabled: boolean;
  expiresAt: string;
  expired: boolean;
}
export interface SettingsView {
  revision: number;
  activeRevision: number;
  operatorTenantId: number;
  demoTenantId: number;
  config: SettingsInput;
  secretsConfigured: Record<'loginEncryption' | 'outbound' | 'sms', boolean>;
  keys: ServiceKey[];
  missing: string[];
  localReady: boolean;
  source: string;
  notice: string;
}
export interface IssuedKey {
  settings: SettingsView;
  keyId: string;
  kind: KeyKind;
  value: string;
}
export const getSettings = () =>
  requestClient.get<SettingsView>('/crm/trial-settings/get');
export const saveSettings = (data: SettingsInput) =>
  requestClient.put<SettingsView>('/crm/trial-settings/save', data);
export const issueKey = (revision: number, kind: KeyKind, days: number) =>
  requestClient.post<IssuedKey>('/crm/trial-settings/keys/issue', {
    revision,
    kind,
    days,
  });
export const revokeKey = (revision: number, keyId: string, kind: KeyKind) =>
  requestClient.post<SettingsView>('/crm/trial-settings/keys/revoke', {
    revision,
    keyId,
    kind,
  });

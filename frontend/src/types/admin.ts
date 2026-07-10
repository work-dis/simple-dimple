export type AdminUserSummary = {
  id: string;
  login: string;
  displayName: string;
  contact: string;
  contactType: "telegram" | "email";
  isAdmin: boolean;
  opsAlertImmediateEnabled: boolean;
  opsAlertDigestEnabled: boolean;
  opsAlertEscalationTier: "primary" | "secondary";
  status: "active" | "blocked" | "trial";
  memberSince: string;
  lastAuthenticatedAt: string | null;
};

export type AdminUsersResponse = {
  users: AdminUserSummary[];
};

export type UpdateAdminUserResponse = {
  user: AdminUserSummary;
};

// Шаг 5 (PRIORITY_PLAN.md) — fleet provisioning для Xray-нод.
export type AdminEndpointTransportSummary = {
  port: number;
  sni: string;
  fingerprint: string;
  flow: string;
  shortId: string;
};

export type AdminEndpointSummary = {
  id: string;
  label: string;
  provider: string;
  asn: number | null;
  countryCode: string;
  city: string | null;
  poolCode: string;
  region: string | null;
  ipAddress: string;
  protocol: string;
  transportProfile: string;
  latencyMs: number;
  loadPercent: number;
  isActive: boolean;
  lastHealthCheckAt: string | null;
  lastHealthCheckOk: boolean | null;
  consecutiveHealthFailures: number;
  retiredAt: string | null;
  retiredReason: string | null;
  transport: AdminEndpointTransportSummary | null;
  createdAt: string;
};

export type AdminEndpointsResponse = {
  endpoints: AdminEndpointSummary[];
};

export type SetAdminEndpointActiveResponse = {
  endpoint: AdminEndpointSummary;
};

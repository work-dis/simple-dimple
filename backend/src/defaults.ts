import type { AccountSummary, AuthSessionSummary, ServerOption, SessionState } from "./types.js";

export const defaultServerPools = [
  {
    id: "pool-de-fra",
    code: "fra-a",
    provider: "Hetzner",
    asn: 24940,
    countryCode: "DE",
    region: "Germany",
    priority: 10
  },
  {
    id: "pool-nl-ams",
    code: "ams-b",
    provider: "Leaseweb",
    asn: 16265,
    countryCode: "NL",
    region: "Netherlands",
    priority: 20
  },
  {
    id: "pool-pl-waw",
    code: "waw-c",
    provider: "OVH",
    asn: 16276,
    countryCode: "PL",
    region: "Poland",
    priority: 30
  }
];

export const defaultEndpoints: ServerOption[] = [
  {
    id: "de-fra-1",
    label: "Frankfurt Alpha",
    region: "Germany",
    countryCode: "DE",
    provider: "Hetzner",
    asn: 24940,
    ipAddress: "203.0.113.10",
    poolCode: "fra-a",
    protocol: "vless",
    transportProfile: "reality-tcp",
    latencyMs: 46,
    loadPercent: 34
  },
  {
    id: "nl-ams-1",
    label: "Amsterdam Breeze",
    region: "Netherlands",
    countryCode: "NL",
    provider: "Leaseweb",
    asn: 16265,
    ipAddress: "203.0.113.20",
    poolCode: "ams-b",
    protocol: "trojan",
    transportProfile: "tls-tcp",
    latencyMs: 39,
    loadPercent: 51
  },
  {
    id: "pl-waw-1",
    label: "Warsaw Pulse",
    region: "Poland",
    countryCode: "PL",
    provider: "OVH",
    asn: 16276,
    ipAddress: "203.0.113.30",
    poolCode: "waw-c",
    protocol: "shadowsocks-2022",
    transportProfile: "tcp-emergency",
    latencyMs: 28,
    loadPercent: 43
  }
];

export const defaultEndpointDetails = [
  {
    ...defaultEndpoints[0],
    serverPoolId: defaultServerPools[0].id,
    ipAddress: "203.0.113.10",
    city: "Frankfurt"
  },
  {
    ...defaultEndpoints[1],
    serverPoolId: defaultServerPools[1].id,
    ipAddress: "203.0.113.20",
    city: "Amsterdam"
  },
  {
    ...defaultEndpoints[2],
    serverPoolId: defaultServerPools[2].id,
    ipAddress: "203.0.113.30",
    city: "Warsaw"
  }
] as const;

export const serverOptions: ServerOption[] = defaultEndpoints;

export const defaultState: SessionState = {
  status: "disconnected",
  activeServerId: serverOptions[0].id,
  updatedAt: new Date().toISOString(),
  connectCount: 0
};

export const defaultAccount: AccountSummary = {
  user: {
    id: "user-demo-1",
    login: "demo",
    displayName: "Nikolaj",
    contact: "telegram @simpledimple",
    contactType: "telegram",
    isAdmin: true,
    status: "active",
    memberSince: "2026-06-15"
  },
  subscription: {
    plan: "Simple Beta",
    renewalDate: "2026-08-01",
    status: "active",
    autoRenew: true
  },
  devices: [
    {
      id: "device-ios-1",
      name: "iPhone 15",
      platform: "iOS",
      lastSeenAt: new Date().toISOString(),
      isCurrent: true
    }
  ]
};

export const defaultAuthSession: AuthSessionSummary = {
  id: "primary",
  userId: null,
  provider: "credentials",
  status: "revoked",
  isAuthenticated: false,
  lastAuthenticatedAt: null,
  expiresAt: null
};

export const defaultPasswordCredential = {
  login: "demo",
  password: "change-me"
};

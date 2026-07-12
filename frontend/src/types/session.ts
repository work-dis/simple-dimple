import type {
  RouteHealthSnapshot,
  RoutePolicy,
  ServerOption,
} from "./route";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type Session = {
  status: ConnectionStatus;
  activeServerId: string;
  updatedAt: string;
  connectCount: number;
};

export type EndpointAssignment = {
  id: string;
  endpointId: string;
  deviceId: string | null;
  assignmentReason: string;
  assignedAt: string;
  expiresAt: string | null;
};

// Протокольная diversity (ROADMAP.md, Этап 6): зеркалит backend
// backend/src/types.ts ConnectionConfigSummary — discriminated union по
// protocol, каждый вариант несёт свой набор transport-параметров.
export type ConnectionConfigSummary =
  | {
      endpointId: string;
      protocol: "vless";
      security: "reality";
      uri: string;
      params: {
        uuid: string;
        address: string;
        port: number;
        flow: string;
        sni: string;
        fingerprint: string;
        publicKey: string;
        shortId: string;
      };
    }
  | {
      endpointId: string;
      protocol: "trojan";
      security: "tls";
      uri: string;
      params: {
        password: string;
        address: string;
        port: number;
        sni: string;
        fingerprint: string;
        alpn: string;
        // base64(SHA-256(DER cert)) для self-signed нод — см. Decision 053.
        certSha256: string | null;
      };
    }
  | {
      endpointId: string;
      protocol: "shadowsocks-2022";
      security: "none";
      uri: string;
      params: {
        method: string;
        serverKey: string;
        userKey: string;
        address: string;
        port: number;
      };
    };

export type SessionResponse = {
  session: Session;
  servers?: ServerOption[];
  currentAssignment: EndpointAssignment | null;
  routeHealth: RouteHealthSnapshot[];
  routePolicy: RoutePolicy;
  connectionConfig?: ConnectionConfigSummary | null;
};

export type NavigatorConnectionLike = {
  type?: string;
  effectiveType?: string;
};

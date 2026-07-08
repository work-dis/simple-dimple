import type {
  RouteHealthSnapshot,
  RoutePolicy,
  ServerOption,
} from "./route";
import type { TelemetryNetworkContext } from "./route";

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

export type ConnectionConfigSummary = {
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

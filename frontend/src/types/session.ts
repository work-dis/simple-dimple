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

export type SessionResponse = {
  session: Session;
  servers?: ServerOption[];
  currentAssignment: EndpointAssignment | null;
  routeHealth: RouteHealthSnapshot[];
  routePolicy: RoutePolicy;
};

export type NavigatorConnectionLike = {
  type?: string;
  effectiveType?: string;
};

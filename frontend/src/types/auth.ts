export type VerificationProvider = "email" | "telegram";

export type AuthSession = {
  id: string;
  userId: string | null;
  provider: "credentials" | "telegram" | "email";
  status: "active" | "revoked" | "expired";
  isAuthenticated: boolean;
  lastAuthenticatedAt: string | null;
  expiresAt: string | null;
};

export type AuthChallenge = {
  challengeId: string;
  provider: VerificationProvider;
  target: string;
  expiresAt: string;
};

export type AuthResponse = {
  auth: AuthSession;
};

export type Screen =
  | "home"
  | "server"
  | "serverAdvanced"
  | "account"
  | "accountServers"
  | "ops"
  | "admin";

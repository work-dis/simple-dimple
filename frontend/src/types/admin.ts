export type AdminUserSummary = {
  id: string;
  login: string;
  displayName: string;
  contact: string;
  contactType: "telegram" | "email";
  isAdmin: boolean;
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

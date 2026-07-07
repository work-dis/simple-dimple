export type SubscriptionSummary = {
  plan: string;
  renewalDate: string;
  status: "active" | "grace";
  autoRenew: boolean;
};

export type DeviceSummary = {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

export type AccountSummary = {
  user: {
    id: string;
    login: string;
    displayName: string;
    contact: string;
    contactType: "telegram" | "email";
    isAdmin: boolean;
    status: "active" | "blocked" | "trial";
    memberSince: string;
  };
  subscription: SubscriptionSummary;
  devices: DeviceSummary[];
};

export type AccountResponse = {
  account: AccountSummary;
};

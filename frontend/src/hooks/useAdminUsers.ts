import { useState } from "react";

import { HttpError, readJson } from "../lib";
import type {
  AdminUserSummary,
  AdminUsersResponse,
  UpdateAdminUserResponse,
} from "../types";

interface UseAdminUsersOptions {
  currentUserId: string | null;
  onClearError: () => void;
  onCurrentUserAdminChanged: (nextIsAdmin: boolean) => void;
  onError: (message: string) => void;
}

type AdminUserPatch = {
  isAdmin?: boolean;
  opsAlertImmediateEnabled?: boolean;
  opsAlertDigestEnabled?: boolean;
  opsAlertEscalationTier?: "primary" | "secondary";
};

export function useAdminUsers({
  currentUserId,
  onClearError,
  onCurrentUserAdminChanged,
  onError,
}: UseAdminUsersOptions) {
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadAdminUsers() {
    try {
      onClearError();
      const data = await readJson<AdminUsersResponse>("/api/admin/users");
      setAdminUsers(data.users);
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно войти, чтобы открыть admin-экран"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Этот раздел доступен только администратору"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    }
  }

  async function updateAdminUser(targetUser: AdminUserSummary, patch: AdminUserPatch) {
    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<UpdateAdminUserResponse>(
        `/api/admin/users/${targetUser.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );

      setAdminUsers((prev) =>
        prev.map((user) => (user.id === data.user.id ? data.user : user)),
      );

      if (currentUserId === data.user.id) {
        onCurrentUserAdminChanged(data.user.isAdmin);
      }
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 403
          ? "Нужен admin-доступ"
          : nextError instanceof HttpError && nextError.status === 404
            ? "Пользователь не найден"
            : nextError instanceof HttpError && nextError.status === 409
              ? "Нельзя снять admin-флаг с последнего администратора"
              : nextError instanceof Error
                ? nextError.message
                : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleUserAdmin(targetUser: AdminUserSummary) {
    await updateAdminUser(targetUser, { isAdmin: !targetUser.isAdmin });
  }

  async function toggleImmediateRouting(targetUser: AdminUserSummary) {
    await updateAdminUser(targetUser, {
      opsAlertImmediateEnabled: !targetUser.opsAlertImmediateEnabled,
    });
  }

  async function toggleDigestRouting(targetUser: AdminUserSummary) {
    await updateAdminUser(targetUser, {
      opsAlertDigestEnabled: !targetUser.opsAlertDigestEnabled,
    });
  }

  async function toggleEscalationTier(targetUser: AdminUserSummary) {
    await updateAdminUser(targetUser, {
      opsAlertEscalationTier:
        targetUser.opsAlertEscalationTier === "primary"
          ? "secondary"
          : "primary",
    });
  }

  function clearAdminUsers() {
    setAdminUsers([]);
  }

  return {
    adminUsers,
    isSubmitting,
    loadAdminUsers,
    toggleUserAdmin,
    toggleImmediateRouting,
    toggleDigestRouting,
    toggleEscalationTier,
    clearAdminUsers,
  };
}

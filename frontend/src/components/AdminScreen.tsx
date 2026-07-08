import type { AuthSession, AccountSummary, AdminUserSummary } from "../types";
import { formatUserStatus } from "../lib/formatters";

interface Props {
  auth: AuthSession | null;
  account: AccountSummary | null;
  adminUsers: AdminUserSummary[];
  isSubmitting: boolean;
  onToggleUserAdmin: (user: AdminUserSummary) => void;
  onToggleImmediateRouting: (user: AdminUserSummary) => void;
  onToggleDigestRouting: (user: AdminUserSummary) => void;
  onToggleEscalationTier: (user: AdminUserSummary) => void;
  onReload: () => void;
}

export function AdminScreen({
  auth,
  account,
  adminUsers,
  isSubmitting,
  onToggleUserAdmin,
  onToggleImmediateRouting,
  onToggleDigestRouting,
  onToggleEscalationTier,
  onReload,
}: Props) {
  const canView = auth?.isAuthenticated && account?.user.isAdmin;

  return (
    <>
      <h1>Admin</h1>
      <p className="hint">
        Небольшой служебный экран для управления admin-доступом, delivery routing и escalation chain без ручной правки БД.
      </p>

      {canView ? (
        <>
          <div className="details">
            <div>
              <span>Всего пользователей</span>
              <strong>{adminUsers.length}</strong>
            </div>
            <div>
              <span>Администраторов</span>
              <strong>{adminUsers.filter((u) => u.isAdmin).length}</strong>
            </div>
            <div>
              <span>Текущий админ</span>
              <strong>{account!.user.displayName}</strong>
            </div>
          </div>

          <div className="opsSection">
            <div className="opsHeaderRow">
              <h2>Доступ к admin/ops</h2>
              <button
                className="ghostButton"
                onClick={onReload}
                disabled={isSubmitting}
              >
                Обновить
              </button>
            </div>

            <div className="serverList">
              {adminUsers.map((user) => (
                <div key={user.id} className="serverButton">
                  <span>
                    {user.displayName} · {user.isAdmin ? "Admin" : "User"}
                  </span>
                  <small>
                    {user.login} · {user.contact} · {user.contactType}
                  </small>
                  <small>
                    {formatUserStatus(user.status)} · с{" "}
                    {new Date(user.memberSince).toLocaleDateString("ru-RU")}
                  </small>
                  <small>
                    {user.lastAuthenticatedAt
                      ? `Последний вход ${new Date(user.lastAuthenticatedAt).toLocaleString("ru-RU")}`
                      : "Входов пока не было"}
                  </small>
                  <small>
                    routing · tier {user.opsAlertEscalationTier} · immediate{" "}
                    {user.opsAlertImmediateEnabled ? "on" : "off"} · digest{" "}
                    {user.opsAlertDigestEnabled ? "on" : "off"}
                  </small>
                  <button
                    className="secondaryButton adminActionButton"
                    onClick={() => void onToggleUserAdmin(user)}
                    disabled={isSubmitting}
                  >
                    {user.isAdmin ? "Снять admin" : "Выдать admin"}
                  </button>
                  {user.isAdmin ? (
                    <>
                      <button
                        className="ghostButton"
                        onClick={() => void onToggleEscalationTier(user)}
                        disabled={isSubmitting}
                      >
                        Tier: {user.opsAlertEscalationTier === "primary" ? "Primary" : "Secondary"}
                      </button>
                      <button
                        className="ghostButton"
                        onClick={() => void onToggleImmediateRouting(user)}
                        disabled={isSubmitting}
                      >
                        Immediate {user.opsAlertImmediateEnabled ? "on" : "off"}
                      </button>
                      <button
                        className="ghostButton"
                        onClick={() => void onToggleDigestRouting(user)}
                        disabled={isSubmitting}
                      >
                        Digest {user.opsAlertDigestEnabled ? "on" : "off"}
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="signedOutCard">
          <strong>
            {!auth?.isAuthenticated
              ? "Нужно войти, чтобы открыть admin-экран."
              : "Этот раздел доступен только администратору."}
          </strong>
        </div>
      )}
    </>
  );
}

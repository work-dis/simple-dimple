import type {
  AuthSession,
  AuthChallenge,
  AccountSummary,
  VerificationProvider,
} from "../types";
import { AuthForms } from "./AuthForms";

interface Props {
  auth: AuthSession | null;
  account: AccountSummary | null;
  displayNameDraft: string;
  contactDraft: string;
  isLoading: boolean;
  isSubmitting: boolean;
  loginDraft: string;
  passwordDraft: string;
  registerNameDraft: string;
  challengeProvider: VerificationProvider;
  challengeTargetDraft: string;
  challengeCodeDraft: string;
  challengeDisplayNameDraft: string;
  activeChallenge: AuthChallenge | null;
  authMode: "login" | "register" | "code";
  onSetDisplayNameDraft: (value: string) => void;
  onSetContactDraft: (value: string) => void;
  onSaveContact: () => void;
  onLogout: () => void;
  onSetLoginDraft: (value: string) => void;
  onSetPasswordDraft: (value: string) => void;
  onSetRegisterNameDraft: (value: string) => void;
  onSetChallengeProvider: (value: VerificationProvider) => void;
  onSetChallengeTargetDraft: (value: string) => void;
  onSetChallengeCodeDraft: (value: string) => void;
  onSetChallengeDisplayNameDraft: (value: string) => void;
  onSetAuthMode: (mode: "login" | "register" | "code") => void;
  onLoginWithPassword: () => void;
  onRegisterWithPassword: () => void;
  onRequestVerificationCode: () => void;
  onVerifyCodeAuth: () => void;
}

export function AccountScreen({
  auth,
  account,
  displayNameDraft,
  contactDraft,
  isLoading,
  isSubmitting,
  loginDraft,
  passwordDraft,
  registerNameDraft,
  challengeProvider,
  challengeTargetDraft,
  challengeCodeDraft,
  challengeDisplayNameDraft,
  activeChallenge,
  authMode,
  onSetDisplayNameDraft,
  onSetContactDraft,
  onSaveContact,
  onLogout,
  onSetLoginDraft,
  onSetPasswordDraft,
  onSetRegisterNameDraft,
  onSetChallengeProvider,
  onSetChallengeTargetDraft,
  onSetChallengeCodeDraft,
  onSetChallengeDisplayNameDraft,
  onSetAuthMode,
  onLoginWithPassword,
  onRegisterWithPassword,
  onRequestVerificationCode,
  onVerifyCodeAuth,
}: Props) {
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const accountStatusLabel =
    account?.subscription.status === "active"
      ? "Подписка активна"
      : "Нужна оплата";
  const authStatusLabel = auth?.isAuthenticated
    ? auth.provider === "credentials"
      ? "Вход по логину и паролю"
      : `Вход через ${auth.provider}`
    : "Вы не вошли в аккаунт";

  return (
    <>
      <h1>Аккаунт</h1>
      <p className="hint">
        Служебная информация живет отдельно и не спорит с кнопкой подключения.
      </p>

      <div className="details">
        <div>
          <span>Доступ</span>
          <strong>{authStatusLabel}</strong>
        </div>
        <div>
          <span>Логин</span>
          <strong>{account?.user.login ?? "—"}</strong>
        </div>
        <div>
          <span>Имя</span>
          <strong>{account?.user.displayName ?? "—"}</strong>
        </div>
        <div>
          <span>Тариф</span>
          <strong>{account?.subscription.plan ?? "—"}</strong>
        </div>
        <div>
          <span>Контакт</span>
          <strong>
            {account?.user.contact ?? "—"}
            {account ? ` · ${account.user.contactType}` : ""}
          </strong>
        </div>
        <div>
          <span>Продление</span>
          <strong>
            {account
              ? new Date(account.subscription.renewalDate).toLocaleDateString("ru-RU")
              : "—"}
          </strong>
        </div>
        <div>
          <span>Устройства</span>
          <strong>{account ? `${account.devices.length} из 3 устройств` : "—"}</strong>
        </div>
        <div>
          <span>Статус аккаунта</span>
          <strong>
            {account?.user.status ?? "—"}
            {account?.user.isAdmin ? " · admin" : ""}
          </strong>
        </div>
      </div>

      {isAuthenticated ? (
        <>
          <div className="accountEditor">
            <label className="fieldLabel" htmlFor="display-name-input">
              Имя в аккаунте
            </label>
            <input
              id="display-name-input"
              className="textInput"
              type="text"
              value={displayNameDraft}
              onChange={(e) => onSetDisplayNameDraft(e.target.value)}
              placeholder="Как тебя показывать в аккаунте"
              disabled={isLoading || isSubmitting}
            />
            <label className="fieldLabel" htmlFor="contact-input">
              Контакт для связи
            </label>
            <input
              id="contact-input"
              className="textInput"
              type="text"
              value={contactDraft}
              onChange={(e) => onSetContactDraft(e.target.value)}
              placeholder="telegram @username или email"
              disabled={isLoading || isSubmitting}
            />
            <button
              className="secondaryButton"
              onClick={onSaveContact}
              disabled={isLoading || isSubmitting}
            >
              Сохранить контакт
            </button>
          </div>

          <div className="accountActions">
            {/* Read-only статус — нет backend-эндпоинта для переключения autoRenew, поэтому не <button> */}
            <span className="secondaryButton statusBadge">
              {account?.subscription.autoRenew
                ? "Автопродление включено"
                : "Автопродление выключено"}
            </span>
            <button
              className="ghostButton fullWidth"
              onClick={onLogout}
              disabled={isLoading || isSubmitting}
            >
              Выйти
            </button>
          </div>

          {account?.devices.length ? (
            <div className="deviceList">
              {account.devices.map((device) => (
                <div key={device.id} className="deviceCard">
                  <span>
                    {device.name} · {device.platform}
                  </span>
                  <strong>
                    {device.isCurrent ? "Текущее устройство" : "Другое устройство"} ·{" "}
                    {new Date(device.lastSeenAt).toLocaleString("ru-RU")}
                  </strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="accountFootnote">
            <span>{accountStatusLabel}</span>
            <strong>
              {account
                ? `С нами с ${new Date(account.user.memberSince).toLocaleDateString("ru-RU")}`
                : "Загружаем данные аккаунта..."}
            </strong>
          </div>
        </>
      ) : (
        <AuthForms
          isLoading={isLoading}
          isSubmitting={isSubmitting}
          loginDraft={loginDraft}
          passwordDraft={passwordDraft}
          registerNameDraft={registerNameDraft}
          challengeProvider={challengeProvider}
          challengeTargetDraft={challengeTargetDraft}
          challengeCodeDraft={challengeCodeDraft}
          challengeDisplayNameDraft={challengeDisplayNameDraft}
          activeChallenge={activeChallenge}
          authMode={authMode}
          onSetLoginDraft={onSetLoginDraft}
          onSetPasswordDraft={onSetPasswordDraft}
          onSetRegisterNameDraft={onSetRegisterNameDraft}
          onSetChallengeProvider={onSetChallengeProvider}
          onSetChallengeTargetDraft={onSetChallengeTargetDraft}
          onSetChallengeCodeDraft={onSetChallengeCodeDraft}
          onSetChallengeDisplayNameDraft={onSetChallengeDisplayNameDraft}
          onSetAuthMode={onSetAuthMode}
          onLoginWithPassword={onLoginWithPassword}
          onRegisterWithPassword={onRegisterWithPassword}
          onRequestVerificationCode={onRequestVerificationCode}
          onVerifyCodeAuth={onVerifyCodeAuth}
        />
      )}
    </>
  );
}

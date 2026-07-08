import type { AuthChallenge, VerificationProvider } from "../types";

interface Props {
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

export function AuthForms({
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
  return (
    <div className="signedOutCard">
      <div className="authModeSwitch" aria-label="Выбор auth-режима">
        <button
          className={authMode === "login" ? "serverButton active" : "serverButton"}
          onClick={() => onSetAuthMode("login")}
          disabled={isLoading || isSubmitting}
        >
          <span>Вход</span>
          <small>Использовать готовую пару логин/пароль</small>
        </button>
        <button
          className={authMode === "register" ? "serverButton active" : "serverButton"}
          onClick={() => onSetAuthMode("register")}
          disabled={isLoading || isSubmitting}
        >
          <span>Регистрация</span>
          <small>Создать тестовый аккаунт без email-подтверждения</small>
        </button>
        <button
          className={authMode === "code" ? "serverButton active" : "serverButton"}
          onClick={() => onSetAuthMode("code")}
          disabled={isLoading || isSubmitting}
        >
          <span>Код</span>
          <small>Email verification или Telegram auth</small>
        </button>
      </div>

      {authMode === "code" ? (
        <CodeAuthForm
          challengeProvider={challengeProvider}
          challengeTargetDraft={challengeTargetDraft}
          challengeCodeDraft={challengeCodeDraft}
          challengeDisplayNameDraft={challengeDisplayNameDraft}
          activeChallenge={activeChallenge}
          isLoading={isLoading}
          isSubmitting={isSubmitting}
          onSetChallengeProvider={onSetChallengeProvider}
          onSetChallengeTargetDraft={onSetChallengeTargetDraft}
          onSetChallengeCodeDraft={onSetChallengeCodeDraft}
          onSetChallengeDisplayNameDraft={onSetChallengeDisplayNameDraft}
          onRequestVerificationCode={onRequestVerificationCode}
          onVerifyCodeAuth={onVerifyCodeAuth}
        />
      ) : (
        <PasswordAuthForm
          mode={authMode}
          loginDraft={loginDraft}
          passwordDraft={passwordDraft}
          registerNameDraft={registerNameDraft}
          isLoading={isLoading}
          isSubmitting={isSubmitting}
          onSetLoginDraft={onSetLoginDraft}
          onSetPasswordDraft={onSetPasswordDraft}
          onSetRegisterNameDraft={onSetRegisterNameDraft}
          onSubmit={authMode === "login" ? onLoginWithPassword : onRegisterWithPassword}
        />
      )}
    </div>
  );
}

/* ──────────────── Password sub-form ──────────────── */

interface PasswordFormProps {
  mode: "login" | "register";
  loginDraft: string;
  passwordDraft: string;
  registerNameDraft: string;
  isLoading: boolean;
  isSubmitting: boolean;
  onSetLoginDraft: (value: string) => void;
  onSetPasswordDraft: (value: string) => void;
  onSetRegisterNameDraft: (value: string) => void;
  onSubmit: () => void;
}

function PasswordAuthForm({
  mode,
  loginDraft,
  passwordDraft,
  registerNameDraft,
  isLoading,
  isSubmitting,
  onSetLoginDraft,
  onSetPasswordDraft,
  onSetRegisterNameDraft,
  onSubmit,
}: PasswordFormProps) {
  return (
    <>
      <label className="fieldLabel" htmlFor="auth-login-input">
        Логин
      </label>
      <input
        id="auth-login-input"
        className="textInput"
        type="text"
        value={loginDraft}
        onChange={(e) => onSetLoginDraft(e.target.value)}
        placeholder="Например demo"
        disabled={isLoading || isSubmitting}
      />
      {mode === "register" && (
        <>
          <label className="fieldLabel" htmlFor="register-name-input">
            Имя в аккаунте
          </label>
          <input
            id="register-name-input"
            className="textInput"
            type="text"
            value={registerNameDraft}
            onChange={(e) => onSetRegisterNameDraft(e.target.value)}
            placeholder="Можно оставить пустым"
            disabled={isLoading || isSubmitting}
          />
        </>
      )}
      <label className="fieldLabel" htmlFor="auth-password-input">
        Пароль
      </label>
      <input
        id="auth-password-input"
        className="textInput"
        type="password"
        value={passwordDraft}
        onChange={(e) => onSetPasswordDraft(e.target.value)}
        placeholder="Минимум 6 символов"
        disabled={isLoading || isSubmitting}
      />
      <strong>
        {mode === "login"
          ? "Тестовый seed-аккаунт: demo / change-me"
          : "На этом этапе аккаунт создаётся сразу, без подтверждения email"}
      </strong>
      <button
        className="secondaryButton"
        onClick={onSubmit}
        disabled={isLoading || isSubmitting}
      >
        {mode === "login" ? "Войти" : "Создать аккаунт"}
      </button>
    </>
  );
}

/* ──────────────── Code auth sub-form ──────────────── */

interface CodeFormProps {
  challengeProvider: VerificationProvider;
  challengeTargetDraft: string;
  challengeCodeDraft: string;
  challengeDisplayNameDraft: string;
  activeChallenge: AuthChallenge | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onSetChallengeProvider: (value: VerificationProvider) => void;
  onSetChallengeTargetDraft: (value: string) => void;
  onSetChallengeCodeDraft: (value: string) => void;
  onSetChallengeDisplayNameDraft: (value: string) => void;
  onRequestVerificationCode: () => void;
  onVerifyCodeAuth: () => void;
}

function CodeAuthForm({
  challengeProvider,
  challengeTargetDraft,
  challengeCodeDraft,
  challengeDisplayNameDraft,
  activeChallenge,
  isLoading,
  isSubmitting,
  onSetChallengeProvider,
  onSetChallengeTargetDraft,
  onSetChallengeCodeDraft,
  onSetChallengeDisplayNameDraft,
  onRequestVerificationCode,
  onVerifyCodeAuth,
}: CodeFormProps) {
  return (
    <>
      <label className="fieldLabel" htmlFor="code-provider-input">
        Канал подтверждения
      </label>
      <select
        id="code-provider-input"
        className="textInput"
        value={challengeProvider}
        onChange={(e) => onSetChallengeProvider(e.target.value as VerificationProvider)}
        disabled={isLoading || isSubmitting}
      >
        <option value="telegram">Telegram</option>
        <option value="email">Email</option>
      </select>
      <label className="fieldLabel" htmlFor="code-target-input">
        {challengeProvider === "email" ? "Email" : "Telegram username"}
      </label>
      <input
        id="code-target-input"
        className="textInput"
        type="text"
        value={challengeTargetDraft}
        onChange={(e) => onSetChallengeTargetDraft(e.target.value)}
        placeholder={challengeProvider === "email" ? "you@example.com" : "@simpledimple"}
        disabled={isLoading || isSubmitting}
      />
      <label className="fieldLabel" htmlFor="code-display-name-input">
        Имя для нового аккаунта
      </label>
      <input
        id="code-display-name-input"
        className="textInput"
        type="text"
        value={challengeDisplayNameDraft}
        onChange={(e) => onSetChallengeDisplayNameDraft(e.target.value)}
        placeholder="Нужно только для нового аккаунта"
        disabled={isLoading || isSubmitting}
      />
      <button
        className="secondaryButton"
        onClick={onRequestVerificationCode}
        disabled={isLoading || isSubmitting}
      >
        Запросить код
      </button>
      {activeChallenge ? (
        <strong>
          Код отправлен на {activeChallenge.target} · действует до{" "}
          {new Date(activeChallenge.expiresAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </strong>
      ) : (
        <strong>Код придёт на email или в Telegram.</strong>
      )}
      <label className="fieldLabel" htmlFor="challenge-code-input">
        Код подтверждения
      </label>
      <input
        id="challenge-code-input"
        className="textInput"
        type="text"
        value={challengeCodeDraft}
        onChange={(e) => onSetChallengeCodeDraft(e.target.value)}
        placeholder="6 цифр"
        disabled={isLoading || isSubmitting}
      />
      <button
        className="secondaryButton"
        onClick={onVerifyCodeAuth}
        disabled={isLoading || isSubmitting || !activeChallenge}
      >
        Войти по коду
      </button>
    </>
  );
}

interface Props {
  isLoading: boolean;
  isSubmitting: boolean;
  loginDraft: string;
  passwordDraft: string;
  onSetLoginDraft: (value: string) => void;
  onSetPasswordDraft: (value: string) => void;
  onLoginWithPassword: () => void;
  onNavigateToRegister: () => void;
  onNavigateToLoginCode: () => void;
}

export function LoginScreen({
  isLoading,
  isSubmitting,
  loginDraft,
  passwordDraft,
  onSetLoginDraft,
  onSetPasswordDraft,
  onLoginWithPassword,
  onNavigateToRegister,
  onNavigateToLoginCode,
}: Props) {
  const disabled = isLoading || isSubmitting;

  return (
    <>
      <h1>Вход</h1>
      <p className="hint">Войди в аккаунт, чтобы подключиться к VPN.</p>

      <div className="signedOutCard">
        <label className="fieldLabel" htmlFor="auth-login-input">
          Логин
        </label>
        <input
          id="auth-login-input"
          className="textInput"
          type="text"
          value={loginDraft}
          onChange={(e) => onSetLoginDraft(e.target.value)}
          placeholder="Введите логин"
          disabled={disabled}
        />
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
          disabled={disabled}
        />
        <button
          className="secondaryButton"
          onClick={onLoginWithPassword}
          disabled={disabled}
        >
          Войти
        </button>
      </div>

      <div className="accountActions">
        <button
          className="ghostButton fullWidth"
          onClick={onNavigateToLoginCode}
          disabled={disabled}
        >
          Войти по коду
        </button>
        <button
          className="ghostButton fullWidth"
          onClick={onNavigateToRegister}
          disabled={disabled}
        >
          Создать аккаунт
        </button>
      </div>
    </>
  );
}

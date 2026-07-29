interface Props {
  isLoading: boolean;
  isSubmitting: boolean;
  loginDraft: string;
  passwordDraft: string;
  registerNameDraft: string;
  onSetLoginDraft: (value: string) => void;
  onSetPasswordDraft: (value: string) => void;
  onSetRegisterNameDraft: (value: string) => void;
  onRegisterWithPassword: () => void;
}

export function RegisterScreen({
  isLoading,
  isSubmitting,
  loginDraft,
  passwordDraft,
  registerNameDraft,
  onSetLoginDraft,
  onSetPasswordDraft,
  onSetRegisterNameDraft,
  onRegisterWithPassword,
}: Props) {
  const disabled = isLoading || isSubmitting;

  return (
    <>
      <h1>Регистрация</h1>
      <p className="hint">Создать тестовый аккаунт без email-подтверждения.</p>

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
        <strong>На этом этапе аккаунт создаётся сразу, без подтверждения email</strong>
        <button
          className="secondaryButton"
          onClick={onRegisterWithPassword}
          disabled={disabled}
        >
          Создать аккаунт
        </button>
      </div>
    </>
  );
}

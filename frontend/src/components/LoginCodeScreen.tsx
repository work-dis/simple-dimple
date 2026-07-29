import type { AuthChallenge, VerificationProvider } from "../types";

interface Props {
  isLoading: boolean;
  isSubmitting: boolean;
  challengeProvider: VerificationProvider;
  challengeTargetDraft: string;
  challengeCodeDraft: string;
  challengeDisplayNameDraft: string;
  activeChallenge: AuthChallenge | null;
  onSetChallengeProvider: (value: VerificationProvider) => void;
  onSetChallengeTargetDraft: (value: string) => void;
  onSetChallengeCodeDraft: (value: string) => void;
  onSetChallengeDisplayNameDraft: (value: string) => void;
  onRequestVerificationCode: () => void;
  onVerifyCodeAuth: () => void;
}

export function LoginCodeScreen({
  isLoading,
  isSubmitting,
  challengeProvider,
  challengeTargetDraft,
  challengeCodeDraft,
  challengeDisplayNameDraft,
  activeChallenge,
  onSetChallengeProvider,
  onSetChallengeTargetDraft,
  onSetChallengeCodeDraft,
  onSetChallengeDisplayNameDraft,
  onRequestVerificationCode,
  onVerifyCodeAuth,
}: Props) {
  const disabled = isLoading || isSubmitting;

  return (
    <>
      <h1>Вход по коду</h1>
      <p className="hint">Email verification или Telegram auth.</p>

      <div className="signedOutCard">
        <label className="fieldLabel" htmlFor="code-provider-input">
          Канал подтверждения
        </label>
        <select
          id="code-provider-input"
          className="textInput"
          value={challengeProvider}
          onChange={(e) => onSetChallengeProvider(e.target.value as VerificationProvider)}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
        />
        <button
          className="secondaryButton"
          onClick={onRequestVerificationCode}
          disabled={disabled}
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
          disabled={disabled}
        />
        <button
          className="secondaryButton"
          onClick={onVerifyCodeAuth}
          disabled={disabled || !activeChallenge}
        >
          Войти по коду
        </button>
      </div>
    </>
  );
}

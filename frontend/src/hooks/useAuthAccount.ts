import { useState } from "react";

import { HttpError, readJson } from "../lib";
import type {
  AccountResponse,
  AccountSummary,
  AuthChallenge,
  AuthSession,
  AuthResponse,
  VerificationProvider,
} from "../types";

interface UseAuthAccountOptions {
  onClearError: () => void;
  onError: (message: string) => void;
  onAuthSuccess?: () => Promise<void> | void;
}

export function useAuthAccount({
  onClearError,
  onError,
  onAuthSuccess,
}: UseAuthAccountOptions) {
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "code">(
    "login",
  );
  const [loginDraft, setLoginDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [registerNameDraft, setRegisterNameDraft] = useState("");
  const [challengeProvider, setChallengeProvider] =
    useState<VerificationProvider>("telegram");
  const [challengeTargetDraft, setChallengeTargetDraft] = useState("");
  const [challengeCodeDraft, setChallengeCodeDraft] = useState("");
  const [challengeDisplayNameDraft, setChallengeDisplayNameDraft] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [contactDraft, setContactDraft] = useState("");
  const [activeChallenge, setActiveChallenge] = useState<AuthChallenge | null>(
    null,
  );

  function applyAccount(nextAccount: AccountSummary | null) {
    setAccount(nextAccount);
    setDisplayNameDraft(nextAccount?.user.displayName ?? "");
    setContactDraft(nextAccount?.user.contact ?? "");
  }

  function clearChallengeState() {
    setActiveChallenge(null);
    setChallengeCodeDraft("");
  }

  async function loadAuthAccount() {
    try {
      onClearError();
      const authData = await readJson<AuthResponse>("/api/auth/session");
      setAuth(authData.auth);

      const accountData = authData.auth.isAuthenticated
        ? await readJson<AccountResponse>("/api/account")
        : null;

      applyAccount(accountData?.account ?? null);
      clearChallengeState();
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveContact() {
    const trimmedName = displayNameDraft.trim();
    const trimmedContact = contactDraft.trim();
    if (!trimmedName || !trimmedContact) {
      onError("Укажи имя и контакт для связи");
      return;
    }

    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<{ account: AccountSummary }>(
        "/api/account/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: trimmedName,
            contact: trimmedContact,
          }),
        },
      );

      applyAccount(data.account);
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно снова войти в аккаунт"
          : nextError instanceof Error
            ? nextError.message
            : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loginWithPassword() {
    const login = loginDraft.trim();
    const password = passwordDraft;
    if (!login || !password) {
      onError("Укажи логин и пароль");
      return;
    }

    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<{
        auth: AuthSession;
        account: AccountSummary;
      }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });

      setAuth(data.auth);
      applyAccount(data.account);
      clearChallengeState();
      await onAuthSuccess?.();
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Неверная пара логин/пароль"
          : nextError instanceof Error
            ? nextError.message
            : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function registerWithPassword() {
    const login = loginDraft.trim();
    const password = passwordDraft;
    const displayName = registerNameDraft.trim() || login;
    if (!login || !password) {
      onError("Укажи логин и пароль");
      return;
    }

    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<{
        auth: AuthSession;
        account: AccountSummary;
      }>("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password, displayName }),
      });

      setAuth(data.auth);
      applyAccount(data.account);
      clearChallengeState();
      await onAuthSuccess?.();
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 409
          ? "Такой логин уже занят"
          : nextError instanceof Error
            ? nextError.message
            : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestVerificationCode() {
    const target = challengeTargetDraft.trim();
    if (!target) {
      onError(
        challengeProvider === "email"
          ? "Укажи email для кода"
          : "Укажи Telegram username для кода",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<{ challenge: AuthChallenge }>(
        "/api/auth/challenge",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: challengeProvider, target }),
        },
      );

      setActiveChallenge(data.challenge);
      setChallengeTargetDraft(data.challenge.target);
      setChallengeCodeDraft(data.challenge.code);
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyCodeAuth() {
    if (!activeChallenge?.challengeId || !challengeCodeDraft.trim()) {
      onError("Сначала запроси код, потом введи подтверждение");
      return;
    }

    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<{
        auth: AuthSession;
        account: AccountSummary;
      }>("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: activeChallenge.challengeId,
          code: challengeCodeDraft.trim(),
          displayName: challengeDisplayNameDraft.trim(),
        }),
      });

      setAuth(data.auth);
      applyAccount(data.account);
      clearChallengeState();
      await onAuthSuccess?.();
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Неверный код подтверждения"
          : nextError instanceof HttpError && nextError.status === 410
            ? "Код уже истек, запроси новый"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function logout() {
    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<AuthResponse>("/api/auth/logout", {
        method: "POST",
      });

      setAuth(data.auth);
      applyAccount(null);
      clearChallengeState();
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateCurrentUserAdmin(nextIsAdmin: boolean) {
    if (!account) return;

    setAccount({
      ...account,
      user: { ...account.user, isAdmin: nextIsAdmin },
    });
  }

  return {
    auth,
    account,
    isLoading,
    isSubmitting,
    isAuthenticated: auth?.isAuthenticated ?? false,
    isAdmin: account?.user.isAdmin ?? false,
    authMode,
    loginDraft,
    passwordDraft,
    registerNameDraft,
    challengeProvider,
    challengeTargetDraft,
    challengeCodeDraft,
    challengeDisplayNameDraft,
    displayNameDraft,
    contactDraft,
    activeChallenge,
    setAuthMode,
    setLoginDraft,
    setPasswordDraft,
    setRegisterNameDraft,
    setChallengeProvider,
    setChallengeTargetDraft,
    setChallengeCodeDraft,
    setChallengeDisplayNameDraft,
    setDisplayNameDraft,
    setContactDraft,
    loadAuthAccount,
    saveContact,
    loginWithPassword,
    registerWithPassword,
    requestVerificationCode,
    verifyCodeAuth,
    logout,
    updateCurrentUserAdmin,
  };
}

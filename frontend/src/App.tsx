import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

import type {
  Screen,
} from "./types";
import {
  AccountScreen,
  AccountServersScreen,
  AdminScreen,
  HomeScreen,
  OpsScreen,
  ServerAdvancedScreen,
  ServerScreen,
} from "./components";
import {
  useAdminEndpoints,
  useAdminUsers,
  useAuthAccount,
  useRouteDecisionOps,
  useRouteSession,
} from "./hooks";

import { ErrorDisplay, ScreenBack } from "./components/ui";

/* ──────────────── App component ──────────────── */

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [error, setError] = useState<string | null>(null);

  const routeSession = useRouteSession({
    onClearError: () => setError(null),
    onError: setError,
  });
  const authAccount = useAuthAccount({
    onClearError: () => setError(null),
    onError: setError,
    onAuthSuccess: routeSession.loadSession,
  });
  const routeDecisionOps = useRouteDecisionOps({
    onClearError: () => setError(null),
    onError: setError,
  });
  const adminUsers = useAdminUsers({
    currentUserId: authAccount.account?.user.id ?? null,
    onClearError: () => setError(null),
    onCurrentUserAdminChanged: (nextIsAdmin) => {
      authAccount.updateCurrentUserAdmin(nextIsAdmin);
      if (!nextIsAdmin) {
        setScreen("account");
        routeDecisionOps.clearRouteDecisionOps();
      }
    },
    onError: setError,
  });
  const adminEndpoints = useAdminEndpoints({
    onClearError: () => setError(null),
    onError: setError,
  });

  /* ──────────── Effects ──────────── */

  useEffect(() => {
    void authAccount.loadAuthAccount();
    // Run once on mount only. authAccount is a fresh object every render
    // (its hook doesn't memoize), so listing it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Этап 8 (ROADMAP.md): probe/feedback-отчёты, не отправленные из-за сбоя сети,
  // кэшируются локально (telemetryQueue) — досылаем их при следующем запуске.
  useEffect(() => {
    void import("./lib/telemetryQueue").then(({ flushTelemetryQueue }) => flushTelemetryQueue());
  }, []);

  // Нативный цвет статус-бара под тему приложения (#0f172a — тот же navy,
  // что и theme-color в index.html/connectButton) — иначе статус-бар остаётся
  // системным дефолтом и упакованное приложение визуально выглядит как
  // browser tab, а не отдельный native-экран. No-op в браузере/PWA.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    void StatusBar.setOverlaysWebView({ overlay: false });
    void StatusBar.setStyle({ style: Style.Dark });
    void StatusBar.setBackgroundColor({ color: "#0f172a" });
  }, []);

  // Data-plane (/api/session и др.) требует аутентификацию. Грузим сессию только
  // когда пользователь вошёл; при signed-out — сбрасываем, а не показываем 401.
  useEffect(() => {
    if (authAccount.isLoading) {
      return;
    }
    if (authAccount.isAuthenticated) {
      void routeSession.loadSession();
    } else {
      routeSession.resetSession();
    }
    // Deliberately keyed on the auth booleans only, not routeSession (unstable
    // object identity every render) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authAccount.isAuthenticated, authAccount.isLoading]);

  useEffect(() => {
    if (
      screen !== "ops" ||
      !authAccount.isAuthenticated ||
      !authAccount.isAdmin
    ) {
      return;
    }

    void routeDecisionOps.loadRouteDecisionOps();
    void adminEndpoints.loadAdminEndpoints();
    // Deliberately keyed on screen + auth booleans only, not routeDecisionOps/
    // adminEndpoints (unstable object identity every render) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, authAccount.isAuthenticated, authAccount.isAdmin]);

  useEffect(() => {
    if (
      screen !== "admin" ||
      !authAccount.isAuthenticated ||
      !authAccount.isAdmin
    ) {
      return;
    }
    void adminUsers.loadAdminUsers();
    // Deliberately keyed on screen + auth booleans only, not adminUsers
    // (unstable object identity every render) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, authAccount.isAuthenticated, authAccount.isAdmin]);

  useEffect(() => {
    if (screen !== "server" || !authAccount.isAuthenticated) {
      return;
    }
    void routeSession.refreshServerLatency();
    // Deliberately keyed on screen + auth boolean only, not routeSession
    // (unstable object identity every render) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, authAccount.isAuthenticated]);

  async function changeServer(serverId: string) {
    await routeSession.changeServer(serverId);
    setScreen("home");
  }

  /* ──────────── Derived state ──────────── */

  const isConnected = routeSession.session?.status === "connected";
  const isLoading = routeSession.isLoading || authAccount.isLoading;
  // Каждому экрану — только его собственный busy-флаг. Раньше здесь был один
  // глобальный isSubmitting (OR всех пяти хуков): любой фоновый запрос дизейблил
  // все кнопки на всех экранах, и из-за transition: opacity у button весь UI
  // заметно «мигал» при каждом запросе.
  const homeSubmitting = routeSession.isSubmitting || authAccount.isSubmitting;
  const serverSubmitting = routeSession.isSubmitting;
  const adminSubmitting = adminUsers.isSubmitting;
  const opsSubmitting = routeDecisionOps.isLoading || adminEndpoints.isSubmitting;
  const accountSubmitting = authAccount.isSubmitting;
  const screenSubmitting =
    screen === "home"
      ? homeSubmitting
      : screen === "server" || screen === "serverAdvanced"
        ? serverSubmitting
        : screen === "admin"
          ? adminSubmitting
          : screen === "ops"
            ? opsSubmitting
            : accountSubmitting;

  const showBack =
    screen === "server" ||
    screen === "serverAdvanced" ||
    screen === "account" ||
    screen === "accountServers" ||
    screen === "ops" ||
    screen === "admin";

  // Под-экраны ("Дополнительные настройки", "Конфигурации серверов") должны
  // возвращать на свой родительский экран, а не сразу на home — иначе
  // навигация Account → Servers → назад перепрыгивала бы через сам Account.
  const backTarget: Screen =
    screen === "serverAdvanced" ? "server" : screen === "accountServers" ? "account" : "home";

  /* ──────────── Render ──────────── */

  return (
    <main className="shell">
      <section
        className={
          screen === "ops" || screen === "admin" ? "card cardWide" : "card"
        }
      >
        <div className="eyebrow">
          <p className={`status ${isConnected ? "online" : "offline"}`}>
            {isLoading
              ? "Загружаем..."
              : isConnected
                ? "Подключено"
                : "Не подключено"}
          </p>
          {showBack && (
            <ScreenBack
              onBack={() => setScreen(backTarget)}
              disabled={screenSubmitting}
            />
          )}
        </div>

        {screen === "home" && (
          <HomeScreen
            session={routeSession.session}
            activeServer={routeSession.activeServer}
            currentAssignment={routeSession.currentAssignment}
            authIsAuthenticated={authAccount.isAuthenticated}
            isAdmin={authAccount.isAdmin}
            isLoading={isLoading}
            isSubmitting={homeSubmitting}
            onToggleConnection={routeSession.toggleConnection}
            onNavigate={setScreen}
          />
        )}

        {screen === "server" && (
          <ServerScreen
            session={routeSession.session}
            servers={routeSession.servers}
            routePolicy={routeSession.routePolicy}
            isSubmitting={serverSubmitting}
            onChangeServer={changeServer}
            onOpenAdvanced={() => setScreen("serverAdvanced")}
          />
        )}

        {screen === "serverAdvanced" && (
          <ServerAdvancedScreen
            servers={routeSession.servers}
            routeHealth={routeSession.routeHealth}
          />
        )}

        {screen === "admin" && (
          <AdminScreen
            auth={authAccount.auth}
            account={authAccount.account}
            adminUsers={adminUsers.adminUsers}
            isSubmitting={adminSubmitting}
            onToggleUserAdmin={adminUsers.toggleUserAdmin}
            onToggleImmediateRouting={adminUsers.toggleImmediateRouting}
            onToggleDigestRouting={adminUsers.toggleDigestRouting}
            onToggleEscalationTier={adminUsers.toggleEscalationTier}
            onReload={adminUsers.loadAdminUsers}
          />
        )}

        {screen === "ops" && (
          <OpsScreen
            auth={authAccount.auth}
            account={authAccount.account}
            routeDecisionOps={routeDecisionOps.routeDecisionOps}
            opsAlerts={routeDecisionOps.opsAlerts}
            opsAlertEscalationPreviews={routeDecisionOps.opsAlertEscalationPreviews}
            opsAlertDeliveries={routeDecisionOps.opsAlertDeliveries}
            adminEndpoints={adminEndpoints.adminEndpoints}
            isSubmitting={opsSubmitting}
            onReload={routeDecisionOps.loadRouteDecisionOps}
            onAcknowledgeAlert={routeDecisionOps.acknowledgeOpsAlert}
            onSnoozeAlert={routeDecisionOps.snoozeOpsAlert}
            onUnacknowledgeAlert={routeDecisionOps.unacknowledgeOpsAlert}
            onLoadEscalationPreview={routeDecisionOps.loadOpsAlertEscalationPreview}
            onLoadAlertDeliveries={routeDecisionOps.loadOpsAlertDeliveries}
            onDeliverAlert={routeDecisionOps.deliverOpsAlert}
            onRetryAlertDelivery={routeDecisionOps.retryOpsAlertDelivery}
            onResendAlertDelivery={routeDecisionOps.resendOpsAlertDelivery}
            onDeliverAlertDigest={routeDecisionOps.deliverOpsAlertDigest}
            onRetireEndpoint={adminEndpoints.retireEndpoint}
            onReactivateEndpoint={adminEndpoints.reactivateEndpoint}
            onReloadEndpoints={adminEndpoints.loadAdminEndpoints}
          />
        )}

        {screen === "account" && (
          <AccountScreen
            auth={authAccount.auth}
            account={authAccount.account}
            displayNameDraft={authAccount.displayNameDraft}
            contactDraft={authAccount.contactDraft}
            isLoading={isLoading}
            isSubmitting={accountSubmitting}
            loginDraft={authAccount.loginDraft}
            passwordDraft={authAccount.passwordDraft}
            registerNameDraft={authAccount.registerNameDraft}
            challengeProvider={authAccount.challengeProvider}
            challengeTargetDraft={authAccount.challengeTargetDraft}
            challengeCodeDraft={authAccount.challengeCodeDraft}
            challengeDisplayNameDraft={authAccount.challengeDisplayNameDraft}
            activeChallenge={authAccount.activeChallenge}
            authMode={authAccount.authMode}
            onSetDisplayNameDraft={authAccount.setDisplayNameDraft}
            onSetContactDraft={authAccount.setContactDraft}
            onSaveContact={authAccount.saveContact}
            onLogout={authAccount.logout}
            onSetLoginDraft={authAccount.setLoginDraft}
            onSetPasswordDraft={authAccount.setPasswordDraft}
            onSetRegisterNameDraft={authAccount.setRegisterNameDraft}
            onSetChallengeProvider={authAccount.setChallengeProvider}
            onSetChallengeTargetDraft={authAccount.setChallengeTargetDraft}
            onSetChallengeCodeDraft={authAccount.setChallengeCodeDraft}
            onSetChallengeDisplayNameDraft={authAccount.setChallengeDisplayNameDraft}
            onSetAuthMode={authAccount.setAuthMode}
            onLoginWithPassword={authAccount.loginWithPassword}
            onRegisterWithPassword={authAccount.registerWithPassword}
            onRequestVerificationCode={authAccount.requestVerificationCode}
            onVerifyCodeAuth={authAccount.verifyCodeAuth}
            onOpenServersConfig={() => setScreen("accountServers")}
          />
        )}

        {screen === "accountServers" && (
          <AccountServersScreen
            servers={routeSession.servers}
            serverConnectionConfigs={routeSession.serverConnectionConfigs}
            loadingServerConfigId={routeSession.loadingServerConfigId}
            onLoadConfig={routeSession.loadServerConnectionConfig}
          />
        )}

        <ErrorDisplay error={error} />
      </section>
    </main>
  );
}

export default App;

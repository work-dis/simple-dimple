import { useEffect, useState } from "react";

import type {
  Screen,
} from "./types";
import { AccountScreen, AdminScreen, HomeScreen, OpsScreen, ServerScreen } from "./components";
import {
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

  /* ──────────── Effects ──────────── */

  useEffect(() => {
    void Promise.all([
      routeSession.loadSession(),
      authAccount.loadAuthAccount(),
    ]);
  }, []);

  useEffect(() => {
    if (
      screen !== "ops" ||
      !authAccount.isAuthenticated ||
      !authAccount.isAdmin
    ) {
      return;
    }

    void routeDecisionOps.loadRouteDecisionOps();
  }, [screen, authAccount.isAuthenticated, authAccount.isAdmin]);

  useEffect(() => {
    if (
      screen !== "admin" ||
      !authAccount.isAuthenticated ||
      !authAccount.isAdmin
    ) {
      return;
      return;
    }
    void adminUsers.loadAdminUsers();
  }, [screen, authAccount.isAuthenticated, authAccount.isAdmin]);

  async function changeServer(serverId: string) {
    await routeSession.changeServer(serverId);
    setScreen("home");
  }

  /* ──────────── Derived state ──────────── */

  const isConnected = routeSession.session?.status === "connected";
  const isLoading = routeSession.isLoading || authAccount.isLoading;
  const isSubmitting =
    routeSession.isSubmitting ||
    authAccount.isSubmitting ||
    adminUsers.isSubmitting ||
    routeDecisionOps.isLoading;

  const showBack =
    screen === "server" ||
    screen === "account" ||
    screen === "ops" ||
    screen === "admin";

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
              onBack={() => setScreen("home")}
              disabled={isSubmitting}
            />
          )}
        </div>

        {screen === "home" && (
          <HomeScreen
            session={routeSession.session}
            servers={routeSession.servers}
            activeServer={routeSession.activeServer}
            currentAssignment={routeSession.currentAssignment}
            routePolicy={routeSession.routePolicy}
            authIsAuthenticated={authAccount.isAuthenticated}
            isAdmin={authAccount.isAdmin}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            onToggleConnection={routeSession.toggleConnection}
            onNavigate={setScreen}
          />
        )}

        {screen === "server" && (
          <ServerScreen
            session={routeSession.session}
            servers={routeSession.servers}
            activeServer={routeSession.activeServer}
            currentAssignment={routeSession.currentAssignment}
            routePolicy={routeSession.routePolicy}
            routeHealth={routeSession.routeHealth}
            isSubmitting={isSubmitting}
            onChangeServer={changeServer}
          />
        )}

        {screen === "admin" && (
          <AdminScreen
            auth={authAccount.auth}
            account={authAccount.account}
            adminUsers={adminUsers.adminUsers}
            isSubmitting={isSubmitting}
            onToggleUserAdmin={adminUsers.toggleUserAdmin}
            onReload={adminUsers.loadAdminUsers}
          />
        )}

        {screen === "ops" && (
          <OpsScreen
            auth={authAccount.auth}
            account={authAccount.account}
            routeDecisionOps={routeDecisionOps.routeDecisionOps}
            isSubmitting={isSubmitting}
            onReload={routeDecisionOps.loadRouteDecisionOps}
          />
        )}

        {screen === "account" && (
          <AccountScreen
            auth={authAccount.auth}
            account={authAccount.account}
            displayNameDraft={authAccount.displayNameDraft}
            contactDraft={authAccount.contactDraft}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
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
          />
        )}

        <ErrorDisplay error={error} />
      </section>
    </main>
  );
}

export default App;

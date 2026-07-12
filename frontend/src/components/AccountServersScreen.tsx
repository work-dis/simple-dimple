import { formatProtocolLabel } from "../lib/formatters";
import type { ConnectionConfigSummary, ServerOption } from "../types";

interface Props {
  servers: ServerOption[];
  serverConnectionConfigs: Record<string, ConnectionConfigSummary | null>;
  loadingServerConfigId: string | null;
  onLoadConfig: (endpointId: string) => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Best-effort: Clipboard API недоступен в части WebView/http-контекстов —
    // молчаливый провал лучше, чем падение экрана из-за копирования.
    return false;
  }
}

export function AccountServersScreen({
  servers,
  serverConnectionConfigs,
  loadingServerConfigId,
  onLoadConfig,
}: Props) {
  return (
    <>
      <h1>Конфигурации серверов</h1>
      <p className="hint">
        Конфиг соединения для каждого сервера — можно посмотреть и
        скопировать вручную, например для стороннего клиента.
      </p>

      {servers.length === 0 ? (
        <p className="hint">Список серверов пока пуст.</p>
      ) : (
        <div className="deviceList">
          {servers.map((server) => {
            const hasResult = server.id in serverConnectionConfigs;
            const config = serverConnectionConfigs[server.id];
            const isLoading = loadingServerConfigId === server.id;

            return (
              <div key={server.id} className="deviceCard serverConfigCard">
                <span>
                  {server.label} · {formatProtocolLabel(server.protocol)}
                </span>
                <strong>{server.region}</strong>

                {!hasResult ? (
                  <button
                    className="secondaryButton"
                    onClick={() => onLoadConfig(server.id)}
                    disabled={isLoading}
                  >
                    {isLoading ? "Загружаем..." : "Показать конфиг"}
                  </button>
                ) : config === null ? (
                  <p className="hint">Конфиг для этого сервера сейчас недоступен.</p>
                ) : (
                  <ConnectionConfigReveal config={config} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function ConnectionConfigReveal({ config }: { config: ConnectionConfigSummary }) {
  return (
    <div className="configReveal">
      <textarea
        className="textInput configUri"
        readOnly
        value={config.uri}
        onFocus={(e) => e.currentTarget.select()}
        rows={3}
      />
      <button
        className="secondaryButton"
        onClick={() => void copyToClipboard(config.uri)}
      >
        Скопировать
      </button>
    </div>
  );
}

import { createHash } from "node:crypto";

import { getInventoryPolicyViolation, summarizeInventoryHealth } from "./inventory-policy.js";
import type { InventoryPolicyRecord } from "./inventory-policy.js";
import type { ServerOption } from "./types.js";

// Шаг 6 (PRIORITY_PLAN.md) — устойчивость к блокировке на уровне оператора,
// пункт 2: "клиент видит ограниченное подмножество inventory, не весь парк".
// Design зафиксирован в DECISIONS.md, Decision 024, ДО того как это подключено
// к listServers()/маршрутам — см. её текст для обоснования.
//
// Это сам алгоритм выбора сегмента, чистая функция без побочных эффектов и
// без Prisma — полностью тестируется без БД. Continuity (currentAssignment/
// lastKnownGood/manualEndpointId не должны пропадать из списка из-за
// сегментации) решена через pinnedEndpointIds — см. Decision 024 (обновлено
// 2026-07-09: вместо "откладывать ротацию, пока есть подключение" выбран
// более простой и полностью stateless вариант — pinned-endpoint'ы всегда
// принудительно входят в сегмент, независимо от их hash-ранга).

export type SegmentationOptions = {
  /** Если во всём inventory endpoint'ов не больше этого числа — сегментация не
   * применяется, отдаём всё как есть. Для dev/маленького парка (1-6 нод)
   * подмножество не даёт защиты и только усложняет отладку. */
  passthroughThreshold: number;
  /** Нижняя граница размера сегмента, ниже которой не уходим, даже если
   * policy уже выполнена меньшим числом нод — оставляет клиенту какой-то
   * выбор, а не один-единственный endpoint. */
  minSegmentSize: number;
  /** Как часто пересчитывается сегмент для одного и того же пользователя
   * (мс). Меньше значение — чаще ротация, но и чаще клиент видит "новый"
   * список серверов без видимой причины. */
  rotationPeriodMs: number;
};

export const defaultSegmentationOptions: SegmentationOptions = {
  passthroughThreshold: 6,
  minSegmentSize: 4,
  rotationPeriodMs: 24 * 60 * 60 * 1000
};

function toInventoryRecord(server: ServerOption): InventoryPolicyRecord {
  return {
    endpointId: server.id,
    provider: server.provider,
    asn: server.asn,
    poolCode: server.poolCode,
    countryCode: server.countryCode,
    region: server.region
  };
}

/**
 * Детерминированный, но не предсказуемый без знания subjectId псевдослучайный
 * порядок: sha256(subjectId:rotationBucket:endpointId), взятый как число.
 * Один и тот же пользователь в пределах одного rotation bucket всегда
 * получает один и тот же порядок (стабильный UX в течение периода), но два
 * разных пользователя видят разные сегменты — компрометация одного аккаунта
 * не раскрывает сегмент другого.
 */
function hashRank(subjectId: string, rotationBucket: number, endpointId: string): number {
  const digest = createHash("sha256").update(`${subjectId}:${rotationBucket}:${endpointId}`).digest("hex");
  // Первые 8 hex-символов достаточно для стабильной сортировки, не нужен
  // весь дайджест.
  return Number.parseInt(digest.slice(0, 8), 16);
}

export function computeRotationBucket(nowMs: number, rotationPeriodMs: number): number {
  return Math.floor(nowMs / rotationPeriodMs);
}

/**
 * Выбирает подмножество full inventory для конкретного subjectId (обычно
 * auth.userId). Гарантии:
 *  - результат либо равен full inventory (маленький парк, либо не удалось
 *    набрать policy-совместимый сегмент меньшего размера — fail-open к
 *    доступности, не к урезанию),
 *  - либо является policy-совместимым подмножеством (проходит тот же
 *    summarizeInventoryHealth/getInventoryPolicyViolation, что и
 *    inventory-policy.ts применяет к полному inventory) размера
 *    >= minSegmentSize;
 *  - любой endpointId из pinnedEndpointIds, реально присутствующий в
 *    fullInventory, гарантированно входит в результат — так продолжает быть
 *    видимым уже активное подключение (currentAssignment), последний
 *    известный рабочий маршрут (lastKnownGood) и то, что клиент явно запросил
 *    (manualEndpointId), даже если их hash-ранг для этого пользователя/
 *    периода их бы не выбрал. Id, которого нет в fullInventory (например,
 *    ретайрнутая нода), тихо игнорируется — как и раньше при обычном
 *    `servers.find()` в route-policy.ts;
 *  - для одного subjectId в пределах одного rotation bucket и одного набора
 *    pinnedEndpointIds результат детерминирован (стабилен между вызовами);
 *  - относительный порядок элементов в результате совпадает с их порядком
 *    в fullInventory (pool priority / latency из session.ts), а не с
 *    внутренним hash-порядком отбора — сегментация не должна незаметно менять
 *    сортировку, которую клиент видит при отсутствии данных для ranking.
 */
export function selectClientSegment(
  fullInventory: ServerOption[],
  subjectId: string,
  nowMs: number,
  options: SegmentationOptions = defaultSegmentationOptions,
  pinnedEndpointIds: readonly string[] = []
): ServerOption[] {
  if (fullInventory.length <= options.passthroughThreshold) {
    return fullInventory;
  }

  const byId = new Map(fullInventory.map((server) => [server.id, server]));
  const pinned = pinnedEndpointIds
    .map((id) => byId.get(id))
    .filter((server): server is ServerOption => server !== undefined);
  const pinnedIds = new Set(pinned.map((server) => server.id));

  const rotationBucket = computeRotationBucket(nowMs, options.rotationPeriodMs);
  const ranked = fullInventory
    .filter((server) => !pinnedIds.has(server.id))
    .sort(
      (left, right) =>
        hashRank(subjectId, rotationBucket, left.id) - hashRank(subjectId, rotationBucket, right.id)
    );

  const selected: ServerOption[] = [...pinned];
  const isCompliant = () => {
    const health = summarizeInventoryHealth(selected.map(toInventoryRecord));
    return !getInventoryPolicyViolation(health) && selected.length >= options.minSegmentSize;
  };

  for (const candidate of ranked) {
    if (isCompliant()) {
      break;
    }
    selected.push(candidate);
  }

  if (!isCompliant()) {
    // Не набрали policy-совместимый сегмент меньше полного inventory —
    // отдаём всё, чтобы не подсунуть клиенту заведомо недостаточно
    // устойчивое подмножество.
    return fullInventory;
  }

  const selectedIds = new Set(selected.map((server) => server.id));
  return fullInventory.filter((server) => selectedIds.has(server.id));
}

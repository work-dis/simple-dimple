import { describe, expect, it } from "vitest";

import { getInventoryPolicyViolation, summarizeInventoryHealth } from "../inventory-policy.js";
import { computeRotationBucket, defaultSegmentationOptions, selectClientSegment } from "../inventory-segmentation.js";
import type { ServerOption } from "../types.js";

function makeServer(overrides: Partial<ServerOption> & { id: string }): ServerOption {
  return {
    label: overrides.id,
    region: "Europe",
    countryCode: "DE",
    provider: "Hetzner",
    asn: 24940,
    ipAddress: "203.0.113.10",
    poolCode: "pool-a",
    protocol: "vless",
    transportProfile: "reality-tcp",
    latencyMs: 40,
    loadPercent: 10,
    ...overrides
  };
}

// 12 узлов, 4 провайдера x 3 региона/ASN — заведомо достаточно диверсифицировано,
// чтобы у большинства 4-элементных подмножеств была ненулевая доля policy-совместимых.
function makeLargeDiverseFleet(): ServerOption[] {
  const providers = [
    { provider: "Hetzner", asn: 24940, countryCode: "DE", region: "Europe", poolCode: "de-fra" },
    { provider: "Scaleway", asn: 12876, countryCode: "FR", region: "Europe", poolCode: "fr-par" },
    { provider: "DigitalOcean", asn: 14061, countryCode: "NL", region: "Europe", poolCode: "nl-ams" },
    { provider: "OVH", asn: 16276, countryCode: "PL", region: "Europe", poolCode: "pl-waw" }
  ];

  const servers: ServerOption[] = [];
  for (const p of providers) {
    for (let i = 0; i < 3; i += 1) {
      servers.push(
        makeServer({
          id: `${p.provider.toLowerCase()}-${i}`,
          provider: p.provider,
          asn: p.asn,
          countryCode: p.countryCode,
          region: p.region,
          poolCode: `${p.poolCode}-${i}`
        })
      );
    }
  }
  return servers;
}

function makeSmallFleet(count: number): ServerOption[] {
  return Array.from({ length: count }, (_, i) => makeServer({ id: `dev-${i}` }));
}

const now = new Date("2026-07-09T12:00:00Z").getTime();

describe("selectClientSegment", () => {
  it("returns the full inventory unchanged when the fleet is at or below the passthrough threshold", () => {
    const fleet = makeSmallFleet(defaultSegmentationOptions.passthroughThreshold);
    const segment = selectClientSegment(fleet, "user-1", now);
    expect(segment).toEqual(fleet);
  });

  it("returns a strict subset for a large, diverse fleet", () => {
    const fleet = makeLargeDiverseFleet();
    const segment = selectClientSegment(fleet, "user-1", now);
    expect(segment.length).toBeGreaterThanOrEqual(defaultSegmentationOptions.minSegmentSize);
    expect(segment.length).toBeLessThan(fleet.length);
  });

  it("returned segment is itself inventory-policy compliant", () => {
    const fleet = makeLargeDiverseFleet();
    const segment = selectClientSegment(fleet, "user-1", now);
    const health = summarizeInventoryHealth(
      segment.map((s) => ({
        endpointId: s.id,
        provider: s.provider,
        asn: s.asn,
        poolCode: s.poolCode,
        countryCode: s.countryCode,
        region: s.region
      }))
    );
    expect(getInventoryPolicyViolation(health)).toBeNull();
  });

  it("is deterministic for the same subject within the same rotation bucket", () => {
    const fleet = makeLargeDiverseFleet();
    const first = selectClientSegment(fleet, "user-1", now);
    const second = selectClientSegment(fleet, "user-1", now + 1000);
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
  });

  it("gives different subjects potentially different segments", () => {
    const fleet = makeLargeDiverseFleet();
    const segments = ["user-a", "user-b", "user-c", "user-d", "user-e"].map(
      (subject) => selectClientSegment(fleet, subject, now).map((s) => s.id).join(",")
    );
    const distinctSegments = new Set(segments);
    // Не требуем, чтобы ВСЕ были разными (могут совпасть по хэшу), но с 5
    // разными subject'ами на 12-элементном парке ожидаем больше одного
    // уникального сегмента.
    expect(distinctSegments.size).toBeGreaterThan(1);
  });

  it("rotates the segment once the rotation bucket changes", () => {
    const fleet = makeLargeDiverseFleet();
    const before = selectClientSegment(fleet, "user-1", now);
    const muchLater = now + defaultSegmentationOptions.rotationPeriodMs * 5;
    const after = selectClientSegment(fleet, "user-1", muchLater);

    expect(computeRotationBucket(muchLater, defaultSegmentationOptions.rotationPeriodMs)).not.toBe(
      computeRotationBucket(now, defaultSegmentationOptions.rotationPeriodMs)
    );
    // Порядок/состав может теоретически случайно совпасть, но подряд 5
    // периодов вперёд на 12-элементном парке практически всегда даёт другой
    // сегмент — если это когда-нибудь станет флаки, стоит увеличить сдвиг.
    expect(after.map((s) => s.id)).not.toEqual(before.map((s) => s.id));
  });

  it("always includes a pinned endpoint even if its hash-rank would exclude it", () => {
    const fleet = makeLargeDiverseFleet();
    // Найдём subject, для которого конкретный endpoint по умолчанию НЕ входит
    // в сегмент, затем убедимся, что pin его туда принудительно добавляет.
    const targetId = "ovh-2";
    let subject = "probe-0";
    let baselineSegment = selectClientSegment(fleet, subject, now);
    let i = 0;
    while (baselineSegment.some((s) => s.id === targetId) && i < 50) {
      i += 1;
      subject = `probe-${i}`;
      baselineSegment = selectClientSegment(fleet, subject, now);
    }
    expect(baselineSegment.some((s) => s.id === targetId)).toBe(false);

    const pinnedSegment = selectClientSegment(fleet, subject, now, defaultSegmentationOptions, [targetId]);
    expect(pinnedSegment.some((s) => s.id === targetId)).toBe(true);
  });

  it("silently ignores a pinned id that does not exist in the inventory", () => {
    const fleet = makeLargeDiverseFleet();
    expect(() =>
      selectClientSegment(fleet, "user-1", now, defaultSegmentationOptions, ["nonexistent-id"])
    ).not.toThrow();
    const segment = selectClientSegment(fleet, "user-1", now, defaultSegmentationOptions, ["nonexistent-id"]);
    expect(segment.every((s) => fleet.some((f) => f.id === s.id))).toBe(true);
  });

  it("preserves the original inventory order in the returned segment", () => {
    const fleet = makeLargeDiverseFleet();
    const segment = selectClientSegment(fleet, "user-1", now);
    const originalOrderIds = fleet.map((s) => s.id).filter((id) => segment.some((s) => s.id === id));
    expect(segment.map((s) => s.id)).toEqual(originalOrderIds);
  });

  it("is a strict pass-through for a small fleet even with pins set", () => {
    const fleet = makeSmallFleet(defaultSegmentationOptions.passthroughThreshold);
    const segment = selectClientSegment(fleet, "user-1", now, defaultSegmentationOptions, ["dev-0"]);
    expect(segment).toEqual(fleet);
  });

  it("falls back to the full inventory when no policy-compliant subset can be built", () => {
    // Все узлы — один и тот же provider/ASN/регион: ни одно подмножество не
    // может стать policy-совместимым (нужно >=3 независимых provider), но
    // сам полный список тоже не будет policy-compliant — это ожидаемо и
    // соответствует поведению session.ts::listServers(), который в этом
    // случае бросает StoreError ДО вызова сегментации.
    const homogeneousFleet = Array.from({ length: 10 }, (_, i) =>
      makeServer({ id: `same-${i}`, provider: "OnlyProvider", asn: 1, countryCode: "XX", region: "Only" })
    );
    const segment = selectClientSegment(homogeneousFleet, "user-1", now);
    expect(segment).toEqual(homogeneousFleet);
  });
});

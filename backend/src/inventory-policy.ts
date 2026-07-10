import type { RouteDecisionOpsInventoryHealth } from "./types.js";

export const MINIMUM_INDEPENDENT_FAILURE_DOMAINS = 2;

export type InventoryPolicyRecord = {
  endpointId: string;
  provider: string;
  asn: number | null;
  poolCode: string;
  countryCode: string;
  region: string | null;
};

function buildRegionalDomainKey(record: Pick<InventoryPolicyRecord, "provider" | "asn" | "countryCode" | "region">) {
  return `${record.provider}:${record.countryCode}:${record.region ?? "unknown"}:${record.asn ?? "na"}`;
}

export function summarizeInventoryHealth(records: InventoryPolicyRecord[]): RouteDecisionOpsInventoryHealth {
  const inventoryProviders = new Set(records.map((endpoint) => endpoint.provider));
  const inventoryAsns = new Set(records.map((endpoint) => endpoint.asn).filter((asn): asn is number => asn !== null));
  const inventoryPools = new Set(records.map((endpoint) => endpoint.poolCode));
  const inventoryRegionalGroups = new Map<string, number>();

  for (const endpoint of records) {
    const key = buildRegionalDomainKey(endpoint);
    inventoryRegionalGroups.set(key, (inventoryRegionalGroups.get(key) ?? 0) + 1);
  }

  const largestRegionalDomainSize = [...inventoryRegionalGroups.values()].sort((left, right) => right - left)[0] ?? 0;
  const distinctRegions = inventoryRegionalGroups.size;
  const minimumRecommendedFailureDomains = MINIMUM_INDEPENDENT_FAILURE_DOMAINS;
  const failedDimensions: string[] = [];

  if (records.length < minimumRecommendedFailureDomains) {
    failedDimensions.push(`active endpoints ${records.length}/${minimumRecommendedFailureDomains}`);
  }

  if (inventoryProviders.size < minimumRecommendedFailureDomains) {
    failedDimensions.push(`providers ${inventoryProviders.size}/${minimumRecommendedFailureDomains}`);
  }

  if (inventoryAsns.size < minimumRecommendedFailureDomains) {
    failedDimensions.push(`ASNs ${inventoryAsns.size}/${minimumRecommendedFailureDomains}`);
  }

  if (distinctRegions < minimumRecommendedFailureDomains) {
    failedDimensions.push(`regions ${distinctRegions}/${minimumRecommendedFailureDomains}`);
  }

  const riskLevel: RouteDecisionOpsInventoryHealth["riskLevel"] =
    records.length === 0 ||
    inventoryProviders.size < 2 ||
    inventoryAsns.size < 2 ||
    distinctRegions < 2
      ? "critical"
      : inventoryProviders.size < minimumRecommendedFailureDomains ||
          inventoryAsns.size < minimumRecommendedFailureDomains ||
          distinctRegions < minimumRecommendedFailureDomains ||
          records.length < minimumRecommendedFailureDomains
        ? "watch"
        : "ok";
  const policyViolationMessage =
    failedDimensions.length > 0
      ? `Active inventory must keep at least ${minimumRecommendedFailureDomains} independent failure domains across provider/ASN/region; got ${failedDimensions.join(", ")}.`
      : null;

  return {
    riskLevel,
    activeEndpoints: records.length,
    distinctProviders: inventoryProviders.size,
    distinctAsns: inventoryAsns.size,
    distinctPools: inventoryPools.size,
    distinctRegions,
    largestRegionalDomainSize,
    minimumRecommendedFailureDomains,
    failedDimensions,
    policyViolationMessage
  };
}

export function getInventoryPolicyViolation(health: RouteDecisionOpsInventoryHealth) {
  return health.policyViolationMessage;
}

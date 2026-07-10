import { describe, expect, it } from "vitest";

import { defaultEndpointDetails } from "../defaults.js";
import { getInventoryPolicyViolation, summarizeInventoryHealth } from "../inventory-policy.js";

describe("inventory policy", () => {
  it("keeps default inventory compliant with the minimum failure-domain rule", () => {
    const health = summarizeInventoryHealth(
      defaultEndpointDetails.map((endpoint) => ({
        endpointId: endpoint.id,
        provider: endpoint.provider,
        asn: endpoint.asn,
        poolCode: endpoint.poolCode,
        countryCode: endpoint.countryCode,
        region: endpoint.region
      }))
    );

    expect(health.riskLevel).toBe("ok");
    expect(health.failedDimensions).toEqual([]);
    expect(health.policyViolationMessage).toBeNull();
    expect(getInventoryPolicyViolation(health)).toBeNull();
  });

  it("treats two independent provider/ASN/region domains as compliant", () => {
    const health = summarizeInventoryHealth([
      {
        endpointId: "ep-1",
        provider: "Provider A",
        asn: 64500,
        poolCode: "fra-a",
        countryCode: "DE",
        region: "Germany"
      },
      {
        endpointId: "ep-2",
        provider: "Provider B",
        asn: 64510,
        poolCode: "waw-a",
        countryCode: "PL",
        region: "Poland"
      }
    ]);

    expect(health.riskLevel).toBe("ok");
    expect(health.failedDimensions).toEqual([]);
    expect(getInventoryPolicyViolation(health)).toBeNull();
  });

  it("reports a policy violation when active inventory does not span two provider/ASN/region domains", () => {
    const health = summarizeInventoryHealth([
      {
        endpointId: "ep-1",
        provider: "Provider A",
        asn: 64500,
        poolCode: "fra-a",
        countryCode: "DE",
        region: "Germany"
      }
    ]);

    expect(health.riskLevel).toBe("critical");
    expect(health.failedDimensions).toEqual(["active endpoints 1/2", "providers 1/2", "ASNs 1/2", "regions 1/2"]);
    expect(getInventoryPolicyViolation(health)).toContain("at least 2 independent failure domains");
  });
});

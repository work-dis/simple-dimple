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

  it("reports a policy violation when active inventory does not span three provider/ASN/region domains", () => {
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

    expect(health.riskLevel).toBe("watch");
    expect(health.failedDimensions).toEqual(["active endpoints 2/3", "providers 2/3", "ASNs 2/3", "regions 2/3"]);
    expect(getInventoryPolicyViolation(health)).toContain("at least 3 independent failure domains");
  });
});

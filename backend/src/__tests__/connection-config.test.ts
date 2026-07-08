import { describe, expect, it } from "vitest";

import { buildVlessRealityConnectionConfig, buildVlessRealityConnectionUri } from "../connection-config.js";

const transport = {
  ipAddress: "127.0.0.1",
  port: 8443,
  publicKey: "-9ABqsGJOl9OQEqG2KISZlHW3ePa2mHuCivT892kFh0",
  shortId: "1840a5c9",
  sni: "www.microsoft.com",
  fingerprint: "chrome",
  flow: "xtls-rprx-vision"
};

describe("buildVlessRealityConnectionUri", () => {
  it("builds a VLESS+REALITY URI with the client uuid, host:port and all REALITY params", () => {
    const uri = buildVlessRealityConnectionUri({
      clientUuid: "ef804460-59d5-48af-afe8-da294499651b",
      label: "Frankfurt Alpha (dev Xray inbound)",
      transport
    });

    expect(uri.startsWith("vless://ef804460-59d5-48af-afe8-da294499651b@127.0.0.1:8443?")).toBe(true);

    const [, query] = uri.split("?");
    const [queryString, fragment] = query.split("#");
    const params = new URLSearchParams(queryString);

    expect(params.get("encryption")).toBe("none");
    expect(params.get("flow")).toBe("xtls-rprx-vision");
    expect(params.get("security")).toBe("reality");
    expect(params.get("sni")).toBe("www.microsoft.com");
    expect(params.get("fp")).toBe("chrome");
    expect(params.get("pbk")).toBe("-9ABqsGJOl9OQEqG2KISZlHW3ePa2mHuCivT892kFh0");
    expect(params.get("sid")).toBe("1840a5c9");
    expect(params.get("type")).toBe("tcp");
    expect(decodeURIComponent(fragment)).toBe("Frankfurt Alpha (dev Xray inbound)");
  });
});

describe("buildVlessRealityConnectionConfig", () => {
  it("returns a summary whose params match the input transport and uuid", () => {
    const config = buildVlessRealityConnectionConfig({
      endpointId: "de-fra-1",
      clientUuid: "ef804460-59d5-48af-afe8-da294499651b",
      label: "Frankfurt Alpha (dev Xray inbound)",
      transport
    });

    expect(config.endpointId).toBe("de-fra-1");
    expect(config.protocol).toBe("vless");
    expect(config.security).toBe("reality");
    expect(config.params).toEqual({
      uuid: "ef804460-59d5-48af-afe8-da294499651b",
      address: "127.0.0.1",
      port: 8443,
      flow: "xtls-rprx-vision",
      sni: "www.microsoft.com",
      fingerprint: "chrome",
      publicKey: "-9ABqsGJOl9OQEqG2KISZlHW3ePa2mHuCivT892kFh0",
      shortId: "1840a5c9"
    });
    expect(config.uri).toContain(config.params.uuid);
    expect(config.uri).toContain(`pbk=${config.params.publicKey}`);
  });
});

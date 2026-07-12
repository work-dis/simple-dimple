import { describe, expect, it } from "vitest";

import {
  buildShadowsocksConnectionConfig,
  buildShadowsocksConnectionUri,
  buildTrojanConnectionConfig,
  buildTrojanConnectionUri,
  buildVlessRealityConnectionConfig,
  buildVlessRealityConnectionUri
} from "../connection-config.js";

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

const trojanTransport = {
  ipAddress: "203.0.113.20",
  port: 8443,
  sni: "www.microsoft.com",
  fingerprint: "chrome",
  alpn: "h2,http/1.1",
  certSha256: null
};

describe("buildTrojanConnectionUri", () => {
  it("builds a Trojan+TLS URI with the password, host:port and TLS params", () => {
    const uri = buildTrojanConnectionUri({
      password: "s3cr3t-pass",
      label: "Amsterdam Breeze",
      transport: trojanTransport
    });

    expect(uri.startsWith("trojan://s3cr3t-pass@203.0.113.20:8443?")).toBe(true);

    const [, query] = uri.split("?");
    const [queryString, fragment] = query.split("#");
    const params = new URLSearchParams(queryString);

    expect(params.get("security")).toBe("tls");
    expect(params.get("sni")).toBe("www.microsoft.com");
    expect(params.get("fp")).toBe("chrome");
    expect(params.get("alpn")).toBe("h2,http/1.1");
    expect(params.get("type")).toBe("tcp");
    expect(decodeURIComponent(fragment)).toBe("Amsterdam Breeze");
  });
});

describe("buildTrojanConnectionConfig", () => {
  it("returns a summary whose params match the input transport and password", () => {
    const config = buildTrojanConnectionConfig({
      endpointId: "nl-ams-1",
      password: "s3cr3t-pass",
      label: "Amsterdam Breeze",
      transport: trojanTransport
    });

    expect(config.endpointId).toBe("nl-ams-1");
    expect(config.protocol).toBe("trojan");
    expect(config.security).toBe("tls");
    expect(config.params).toEqual({
      password: "s3cr3t-pass",
      address: "203.0.113.20",
      port: 8443,
      sni: "www.microsoft.com",
      fingerprint: "chrome",
      alpn: "h2,http/1.1",
      certSha256: null
    });
    expect(config.uri).toContain("s3cr3t-pass@203.0.113.20:8443");
    expect(config.uri).not.toContain("certSha256");
  });

  it("includes certSha256 in the URI when the node uses a self-signed cert (Decision 053)", () => {
    const config = buildTrojanConnectionConfig({
      endpointId: "nl-ams-1",
      password: "s3cr3t-pass",
      label: "Amsterdam Breeze",
      transport: { ...trojanTransport, certSha256: "840a7e5c72fdb516e0c73f9040d32d9439c5e1cdbbd185cbc86f69994403052d" }
    });

    // hex, как выдаёт `xray tls hash --cert`/`openssl x509 -fingerprint
    // -sha256` — не base64. Проверено живым подключением, см. Decision 053.
    expect(config.params.certSha256).toBe("840a7e5c72fdb516e0c73f9040d32d9439c5e1cdbbd185cbc86f69994403052d");
    const params = new URLSearchParams(config.uri.split("?")[1].split("#")[0]);
    expect(params.get("certSha256")).toBe("840a7e5c72fdb516e0c73f9040d32d9439c5e1cdbbd185cbc86f69994403052d");
  });
});

const shadowsocksTransport = {
  ipAddress: "203.0.113.30",
  port: 8388,
  method: "2022-blake3-aes-128-gcm"
};

describe("buildShadowsocksConnectionUri", () => {
  it("builds an ss:// URI whose userinfo decodes to method:serverKey:userKey", () => {
    const uri = buildShadowsocksConnectionUri({
      serverKey: "c2VydmVyLWtleQ",
      userKey: "dXNlci1rZXk",
      label: "Warsaw Pulse",
      transport: shadowsocksTransport
    });

    expect(uri.startsWith("ss://")).toBe(true);

    const [, rest] = uri.split("ss://");
    const [userInfo, hostAndFragment] = rest.split("@");
    const decoded = Buffer.from(userInfo, "base64url").toString("utf8");

    expect(decoded).toBe("2022-blake3-aes-128-gcm:c2VydmVyLWtleQ:dXNlci1rZXk");
    expect(hostAndFragment.startsWith("203.0.113.30:8388#")).toBe(true);
    expect(decodeURIComponent(hostAndFragment.split("#")[1])).toBe("Warsaw Pulse");
  });
});

describe("buildShadowsocksConnectionConfig", () => {
  it("returns a summary whose params match the input transport and keys", () => {
    const config = buildShadowsocksConnectionConfig({
      endpointId: "pl-waw-1",
      serverKey: "c2VydmVyLWtleQ",
      userKey: "dXNlci1rZXk",
      label: "Warsaw Pulse",
      transport: shadowsocksTransport
    });

    expect(config.endpointId).toBe("pl-waw-1");
    expect(config.protocol).toBe("shadowsocks-2022");
    expect(config.security).toBe("none");
    expect(config.params).toEqual({
      method: "2022-blake3-aes-128-gcm",
      serverKey: "c2VydmVyLWtleQ",
      userKey: "dXNlci1rZXk",
      address: "203.0.113.30",
      port: 8388
    });
    expect(config.uri).toContain("203.0.113.30:8388");
  });
});

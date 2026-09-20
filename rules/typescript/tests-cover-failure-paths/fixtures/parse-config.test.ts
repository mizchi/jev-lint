import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { describeConfig, parsePort, readConfig } from "./parse-config";

function writeTempConfig(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const path = join(dir, "service.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("readConfig", () => {
  it("fills in defaults for keys the file leaves out", () => {
    const config = readConfig(writeTempConfig({ port: 9000 }));
    assert.deepEqual(config, { port: 9000, host: "127.0.0.1", logLevel: "info" });
  });

  it("keeps every key the file sets", () => {
    const config = readConfig(writeTempConfig({ port: 1, host: "0.0.0.0", logLevel: "warn" }));
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.logLevel, "warn");
  });
});

describe("parsePort", () => {
  it("accepts an integer in range", () => {
    assert.deepEqual(parsePort("8080"), { ok: true, port: 8080 });
  });

  it("refuses a non-integer", () => {
    assert.equal(parsePort("eighty").ok, false);
  });

  it("refuses a port above 65535", () => {
    const result = parsePort("70000");
    assert.equal(result.ok, false);
  });
});

describe("describeConfig", () => {
  it("prints host, port and log level on one line", () => {
    assert.equal(describeConfig({ port: 80, host: "api", logLevel: "debug" }), "api:80 (log debug)");
  });
});

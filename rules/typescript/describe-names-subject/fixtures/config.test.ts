import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig, loadConfig, ConfigLoader } from "../src/config";

describe("parseConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the port from the file", async () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ port: 8080 }));
    const cfg = await loadConfig(join(dir, "app.json"));
    expect(cfg.port).toBe(8080);
  });

  it("rejects a missing file", async () => {
    await expect(loadConfig(join(dir, "missing.json"))).rejects.toThrow(/ENOENT/);
  });

  it("falls back to the default host", async () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ port: 1 }));
    const cfg = await loadConfig(join(dir, "app.json"));
    expect(cfg.host).toBe("127.0.0.1");
  });
});

describe("ConfigLoader", () => {
  let loader: ConfigLoader;
  beforeEach(() => {
    loader = new ConfigLoader({ defaults: { port: 3000, host: "0.0.0.0" } });
  });

  describe("load", () => {
    it("merges defaults under the file's values", async () => {
      const cfg = await loader.load({ port: 8080 });
      expect(cfg).toEqual({ port: 8080, host: "0.0.0.0" });
    });

    it("keeps unknown keys", async () => {
      const cfg = await loader.load({ port: 1, extra: true });
      expect(cfg).toHaveProperty("extra", true);
    });
  });

  describe("watch", () => {
    it("emits once per change", async () => {
      const seen: unknown[] = [];
      const stop = loader.watch((cfg) => seen.push(cfg));
      await loader.load({ port: 1 });
      await loader.load({ port: 2 });
      stop();
      expect(seen).toHaveLength(2);
    });
  });
});

describe("config.ts", () => {
  it("parseConfig accepts an empty object", () => {
    expect(parseConfig({})).toEqual({ port: 3000, host: "127.0.0.1" });
  });

  it("parseConfig rejects a string port", () => {
    expect(() => parseConfig({ port: "80" })).toThrow(/port/);
  });

  it("loadConfig resolves a relative path from cwd", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue("/srv/app");
    await expect(loadConfig("conf/app.json")).rejects.toThrow("/srv/app/conf/app.json");
    spy.mockRestore();
  });
});

describe("when the config file is unreadable", () => {
  it("loadConfig rejects with the underlying error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const file = join(dir, "app.json");
    writeFileSync(file, "{}", { mode: 0o000 });
    await expect(loadConfig(file)).rejects.toThrow(/EACCES/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not fall back to defaults silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const file = join(dir, "app.json");
    writeFileSync(file, "{}", { mode: 0o000 });
    const result = await loadConfig(file).catch((e) => e);
    expect(result).toBeInstanceOf(Error);
    rmSync(dir, { recursive: true, force: true });
  });
});

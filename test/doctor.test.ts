import { strict as assert } from "node:assert";
import { doctor } from "../src/doctor.ts";
import { test } from "./harness.ts";

test("doctor: missing credentials and executables are reported without contacting the provider", () => {
  const report = doctor({ apiKeyAvailable: false, binaryPath: "/missing/ast-grep", nodeVersion: "24.22.2" });
  assert.equal(report.status, "partial"); assert.equal(report.modelRequests, 0);
  assert.ok(report.checks.some((c) => c.id === "api-key" && c.status === "missing"));
  assert.ok(report.checks.some((c) => c.id === "ast-grep" && c.status === "missing"));
  assert.equal(doctor({ apiKeyAvailable: true, binaryPath: process.execPath, nodeVersion: "22.6.0" }).status, "partial");
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  IOS_SIMULATOR_HELPER_UNSUPPORTED_REASON,
  decideNativeSidecarBuild,
  parseMachOArchitectures,
  resolveSimulatorKitFrameworks,
} from "./native-sidecar-build-policy.mjs";

describe("native sidecar build policy", () => {
  it("finds the selected Xcode's real binary in either layout and fails for an incomplete install", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cindy-xcode-layout-"));
    try {
      const developer = path.join(root, "Contents", "Developer");
      const oldDir = path.join(developer, "Library", "PrivateFrameworks");
      const newDir = path.join(root, "Contents", "SharedFrameworks");
      fs.mkdirSync(path.join(newDir, "SimulatorKit.framework"), { recursive: true });
      expect(() => resolveSimulatorKitFrameworks(developer)).toThrow("binary not found");
      fs.writeFileSync(path.join(newDir, "SimulatorKit.framework", "SimulatorKit"), "fixture");
      expect(resolveSimulatorKitFrameworks(developer)).toBe(newDir);
      fs.mkdirSync(path.join(oldDir, "SimulatorKit.framework"), { recursive: true });
      fs.writeFileSync(path.join(oldDir, "SimulatorKit.framework", "SimulatorKit"), "fixture");
      expect(resolveSimulatorKitFrameworks(developer)).toBe(oldDir);
      expect(() => resolveSimulatorKitFrameworks(path.join(root, "Other", "Contents", "Developer")))
        .toThrow("binary not found");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("parses unique architectures from lipo output", () => {
    expect(parseMachOArchitectures("x86_64 arm64e x86_64\n")).toEqual([
      "x86_64",
      "arm64e",
    ]);
  });

  it("builds x86_64 when SimulatorKit provides the slice", () => {
    expect(
      decideNativeSidecarBuild({
        outputMode: "helper",
        targetArchitecture: "x86_64",
        simulatorKitArchitectures: ["x86_64", "arm64e"],
      }),
    ).toEqual({ action: "build", targetArchitectures: ["x86_64"] });
  });

  it("treats arm64e SimulatorKit as link-compatible with an arm64 helper", () => {
    expect(
      decideNativeSidecarBuild({
        outputMode: "helper",
        targetArchitecture: "arm64",
        simulatorKitArchitectures: ["arm64e"],
      }),
    ).toEqual({ action: "build", targetArchitectures: ["arm64"] });
  });

  it("allows only a thin x86_64 helper to fall back when the slice is unavailable", () => {
    expect(
      decideNativeSidecarBuild({
        outputMode: "helper",
        targetArchitecture: "x86_64",
        simulatorKitArchitectures: ["arm64e"],
      }),
    ).toEqual({
      action: "unsupported",
      targetArchitectures: ["x86_64"],
      reason: IOS_SIMULATOR_HELPER_UNSUPPORTED_REASON,
    });
  });

  it("keeps raw, arm64, and universal builds fail-closed when a slice is missing", () => {
    expect(() =>
      decideNativeSidecarBuild({
        outputMode: "raw",
        targetArchitecture: "x86_64",
        simulatorKitArchitectures: ["arm64e"],
      }),
    ).toThrow("missing required architecture(s): x86_64");
    expect(() =>
      decideNativeSidecarBuild({
        outputMode: "helper",
        targetArchitecture: "arm64",
        simulatorKitArchitectures: ["x86_64"],
      }),
    ).toThrow("missing required architecture(s): arm64");
    expect(() =>
      decideNativeSidecarBuild({
        outputMode: "helper",
        targetArchitecture: "universal",
        simulatorKitArchitectures: ["arm64e"],
      }),
    ).toThrow("missing required architecture(s): x86_64");
  });
});

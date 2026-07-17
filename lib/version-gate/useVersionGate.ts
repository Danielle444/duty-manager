"use client";

/**
 * Client version AWARENESS hook (Stage 0B-1).
 *
 * Detects when the running instructor/trainee bundle declares an OLDER
 * compatibility epoch than the currently-served bundle and, on a confirmed
 * mismatch, asks the shell to stop rendering the normal surface and offer a
 * guarded full reload.
 *
 * HARD boundaries (this hook must never cross them):
 * - It is AWARENESS ONLY, never authorization. It blocks no Server Action.
 * - It never reads or clears authentication cookies.
 * - It never clears instructor/trainee identity localStorage
 *   (`duty-manager-instructor-v2`, `duty-manager-student`) or UX-preference
 *   keys, never calls logout, and never inspects session validity.
 * - It FAILS OPEN: if /api/version is unreachable, malformed, or does not
 *   prove the running bundle is behind, the app stays usable.
 * - Its only persisted state is a single sessionStorage loop-guard marker under
 *   its own dedicated key (never an identity key).
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — RO-2…RO-5 / Part 27.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_COMPATIBILITY_VERSION } from "./compatibility-version";

export type VersionGateStatus = "ok" | "update-required" | "reload-failed";

const VERSION_ENDPOINT = "/api/version";

/**
 * The single sessionStorage key this hook is allowed to write. It records the
 * served epoch we have already performed one guarded reload for, so a still-
 * stale bundle after that reload falls back to the static "close and reopen"
 * screen instead of looping. This is NOT an identity or auth key.
 */
export const VERSION_GATE_RELOAD_MARKER_KEY = "dk-version-gate-reload-attempt";

// Repeated triggers (mount + focus + visibilitychange firing together) are
// collapsed to at most one network check per window. Awareness only; a missed
// check simply defers detection to the next trigger.
const CHECK_DEBOUNCE_MS = 5_000;

/**
 * Pure parser for the /api/version body. Returns the served epoch as a finite
 * number, or null for any missing/malformed shape (which callers treat as
 * fail-open).
 */
export function parseServerVersion(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { version?: unknown }).version;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Pure decision function. A confirmed mismatch is ONLY when the served epoch is
 * strictly greater than the running bundle's epoch. Anything else — unknown
 * served epoch, equal epoch, or a served epoch that is somehow behind — fails
 * open to "ok". Once a guarded reload has already been attempted for the exact
 * served epoch, a persistent mismatch resolves to the static "reload-failed"
 * fallback rather than offering the same reload again.
 */
export function decideVersionGateStatus(input: {
  clientVersion: number;
  serverVersion: number | null;
  reloadAttemptedForVersion: number | null;
}): VersionGateStatus {
  const { clientVersion, serverVersion, reloadAttemptedForVersion } = input;
  if (serverVersion === null) return "ok";
  if (serverVersion <= clientVersion) return "ok";
  if (reloadAttemptedForVersion === serverVersion) return "reload-failed";
  return "update-required";
}

function readReloadMarker(): number | null {
  try {
    const raw = window.sessionStorage.getItem(VERSION_GATE_RELOAD_MARKER_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface VersionGate {
  status: VersionGateStatus;
  /** Guarded full reload for the detected mismatch. */
  reload: () => void;
}

export function useVersionGate(options?: { enabled?: boolean }): VersionGate {
  const enabled = options?.enabled ?? true;
  const [status, setStatus] = useState<VersionGateStatus>("ok");
  // The served epoch behind a non-ok status; used to stamp the loop-guard
  // marker just before a guarded reload.
  const [pendingServerVersion, setPendingServerVersion] = useState<number | null>(
    null,
  );

  const lastCheckAtRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  const runCheck = useCallback(async () => {
    if (!enabled) return;
    const now = Date.now();
    if (inFlightRef.current) return;
    if (now - lastCheckAtRef.current < CHECK_DEBOUNCE_MS) return;
    lastCheckAtRef.current = now;
    inFlightRef.current = true;

    let serverVersion: number | null = null;
    try {
      const res = await fetch(VERSION_ENDPOINT, { cache: "no-store" });
      if (res.ok) {
        const data: unknown = await res.json();
        serverVersion = parseServerVersion(data);
      }
    } catch {
      // Unreachable/aborted → fail open.
      serverVersion = null;
    } finally {
      inFlightRef.current = false;
    }

    const reloadAttemptedForVersion = readReloadMarker();
    const next = decideVersionGateStatus({
      clientVersion: APP_COMPATIBILITY_VERSION,
      serverVersion,
      reloadAttemptedForVersion,
    });

    // A definitive, up-to-date reading clears any stale loop-guard marker so a
    // future epoch bump starts fresh. Transient failures (serverVersion null)
    // deliberately leave the marker untouched.
    if (
      next === "ok" &&
      serverVersion !== null &&
      serverVersion <= APP_COMPATIBILITY_VERSION
    ) {
      try {
        window.sessionStorage.removeItem(VERSION_GATE_RELOAD_MARKER_KEY);
      } catch {
        // ignore storage failure
      }
    }

    setStatus(next);
    setPendingServerVersion(next === "ok" ? null : serverVersion);
  }, [enabled]);

  const reload = useCallback(() => {
    // Record that we have used our one guarded reload for this served epoch, so
    // a still-stale bundle afterward shows the static fallback instead of
    // looping. Never touches identity/auth/UX keys.
    try {
      if (pendingServerVersion !== null) {
        window.sessionStorage.setItem(
          VERSION_GATE_RELOAD_MARKER_KEY,
          String(pendingServerVersion),
        );
      }
    } catch {
      // ignore storage failure; still attempt the reload
    }
    window.location.reload();
  }, [pendingServerVersion]);

  useEffect(() => {
    if (!enabled) return;
    void runCheck();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void runCheck();
    };
    const onFocus = () => {
      void runCheck();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, runCheck]);

  return { status, reload };
}

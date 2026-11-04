"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { readBoardId, writeBoardId } from "@/lib/board-cookie";
import { isJudgeBoard } from "@/lib/judge-board";
import { DeskError } from "@/shared/client";
import type { BoardHealth, BoardInfo, Device, Operator } from "@/shared/types";

export type DeskStatus = "loading" | "online" | "offline";

/**
 * Account identity, the fleet, and a polled health snapshot of the board the
 * desk is pointed at. Polling is deliberately slow: the telemetry is for
 * orientation, not for reacting to a spike.
 *
 * When the desk talks to a board directly there is no fleet endpoint, so
 * `devices` stays null and the desk drives that board as-is.
 */
export function useDesk(pollMs = 15_000) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [info, setInfo] = useState<BoardInfo | null>(null);
  const [health, setHealth] = useState<BoardHealth | null>(null);
  const [status, setStatus] = useState<DeskStatus>("loading");
  const [ready, setReady] = useState(false);
  /** Personal fleet only — the shared evaluator demo board is filtered out. */
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeDevice, setActiveDevice] = useState<Device | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setOperator(me.user);
    } catch (err) {
      // The session route already dropped the dead cookies, so /login will not bounce back.
      if (err instanceof DeskError && err.status === 401) {
        window.location.assign("/login");
        return;
      }
      setStatus("offline");
      setReady(true);
      return;
    }

    let boardId = readBoardId();
    try {
      const fleet = await api.listDevices();
      // Shared demo board stays selectable via evaluator session cookie, but is
      // hidden from the operator fleet so the personal desk never lists it.
      const personal = fleet.filter((device) => !isJudgeBoard(device));
      setDevices(personal);
      const demoActive = Boolean(boardId && fleet.some((d) => d.id === boardId && isJudgeBoard(d)));
      if (!personal.length && !demoActive) {
        setActiveDeviceId(null);
        setActiveDevice(null);
        setInfo(null);
        setHealth(null);
        setStatus("offline");
        setReady(true);
        return;
      }
      const known = fleet.some((device) => device.id === boardId);
      if (!boardId || !known) {
        boardId = personal[0]?.id ?? null;
        if (boardId) writeBoardId(boardId);
      }
      setActiveDeviceId(boardId);
      setActiveDevice(fleet.find((device) => device.id === boardId) ?? null);
    } catch {
      // No fleet endpoint: the desk drives a board directly, no routing.
      setDevices(null);
      setActiveDevice(null);
    }

    // Open the desk as soon as identity + fleet resolve. Board telemetry can
    // stall on a slow relay; never leave the operator on "Connecting…".
    setReady(true);

    try {
      const [boardInfo, boardHealth] = await Promise.race([
        Promise.all([api.boardInfo(), api.boardHealth()]),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("board_telemetry_timeout")), 12_000);
        }),
      ]);
      setInfo(boardInfo);
      setHealth(boardHealth);
      setStatus("online");
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);

  /** Point the desk at another board. The cookie is what the BFF routes on. */
  const selectDevice = useCallback(
    async (id: string) => {
      if (id === activeDeviceId) return;
      writeBoardId(id);
      setActiveDeviceId(id);
      setInfo(null);
      setHealth(null);
      setStatus("loading");
      await refresh();
    },
    [activeDeviceId, refresh],
  );

  /** Take a board someone just started pairing, then drive it. */
  const claimDevice = useCallback(
    async (code: string): Promise<Device> => {
      const device = await api.claimPairing(code.trim());
      writeBoardId(device.id);
      setActiveDeviceId(device.id);
      setInfo(null);
      setHealth(null);
      await refresh();
      return device;
    },
    [refresh],
  );

  return {
    operator,
    info,
    health,
    status,
    ready,
    devices,
    activeDevice,
    activeDeviceId,
    selectDevice,
    claimDevice,
    refresh,
  };
}

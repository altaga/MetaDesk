"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { readBoardId, writeBoardId } from "@/lib/board-cookie";
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
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

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
      setDevices(fleet);
      if (!fleet.length) {
        setInfo(null);
        setHealth(null);
        setStatus("offline");
        setReady(true);
        return;
      }
      if (!boardId || !fleet.some((device) => device.id === boardId)) {
        boardId = fleet[0].id;
        writeBoardId(boardId);
      }
      setActiveDeviceId(boardId);
    } catch {
      // No fleet endpoint: the desk drives a board directly, no routing.
      setDevices(null);
    }

    try {
      const [boardInfo, boardHealth] = await Promise.all([api.boardInfo(), api.boardHealth()]);
      setInfo(boardInfo);
      setHealth(boardHealth);
      setStatus("online");
    } catch {
      setStatus("offline");
    }
    setReady(true);
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

  const activeDevice = devices?.find((device) => device.id === activeDeviceId) ?? null;

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

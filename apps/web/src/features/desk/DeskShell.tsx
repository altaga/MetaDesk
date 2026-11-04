"use client";

import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { BoardView } from "@/features/board/BoardView";
import { ChatView } from "@/features/chat/ChatView";
import { useDesk } from "@/features/desk/useDesk";
import { FleetView } from "@/features/fleet/FleetView";
import { LibraryView } from "@/features/library/LibraryView";
import { MachineView } from "@/features/machine/MachineView";
import { PairWizard } from "@/features/pairing/PairWizard";
import { Nova } from "@/features/nova/Nova";
import { onGuide, type DeskView } from "@/features/nova/guideBus";
import { PwaInstallButton } from "@/features/pwa/PwaInstallButton";
import { isJudgeBoard } from "@/lib/judge-board";
import { BrandMark } from "@/ui/BrandMark";
import { Icon, type IconName } from "@/ui/Icon";

const RAIL: Array<{ id: DeskView; label: string; icon: IconName; guide: string }> = [
  { id: "chat", label: "Chat", icon: "chat", guide: "nav-chat" },
  { id: "machine", label: "Machine", icon: "machine", guide: "nav-machine" },
  { id: "board", label: "Board", icon: "board", guide: "nav-board" },
  { id: "library", label: "Library", icon: "library", guide: "nav-library" },
  { id: "fleet", label: "Fleet", icon: "fleet", guide: "nav-fleet" },
];

export function DeskShell({ startPairing = false }: { startPairing?: boolean }) {
  const [view, setView] = useState<DeskView>(startPairing ? "fleet" : "chat");
  // Board setup lives inside Fleet, so the wizard keeps the desk around it.
  const [pairing, setPairing] = useState(startPairing);
  const desk = useDesk();

  // Nova navigates through the guide bus: views, and boards picked by name.
  useEffect(
    () =>
      onGuide((request) => {
        if (request.kind === "view") setView(request.view);
        if (request.kind === "machine_tab") setView("machine");
        if (request.kind === "new_chat") setView("chat");
        if (request.kind === "select_board") {
          const wanted = request.name.trim().toLowerCase();
          const match = desk.devices?.find((device) => device.name.toLowerCase() === wanted);
          if (match) void desk.selectDevice(match.id);
        }
      }),
    [desk.devices, desk.selectDevice],
  );

  async function signOut() {
    await logoutAction();
    window.location.assign("/login");
  }

  const dot =
    desk.status === "online" ? "md-status__dot--on" : desk.status === "offline" ? "md-status__dot--off" : "";
  const board =
    desk.activeDevice?.name ?? (desk.devices === null ? desk.info?.hostname ?? "" : "");
  // With no board paired there is nothing to drive, so the fleet is the only view.
  const active: DeskView = desk.devices !== null && desk.devices.length === 0 ? "fleet" : view;

  const statusLabel = desk.status === "loading" ? "connecting" : desk.status;
  const temp =
    desk.health?.temp_c !== null && desk.health?.temp_c !== undefined ? ` · ${desk.health.temp_c}°C` : "";
  const operator = desk.operator?.username ?? "";

  return (
    <div className="md-shell">
      <aside className="md-side" aria-label="Desk sidebar">
        <div className="md-side__top">
          <BrandMark />
        </div>

        <nav className="md-side__nav" aria-label="Desk">
          {RAIL.map((item) => (
            <button
              key={item.id}
              className={`md-nav ${active === item.id ? "md-nav--active" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
              data-guide={item.guide}
              onClick={() => {
                setPairing(false);
                setView(item.id);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="md-side__grow" />
        <Nova view={active} deviceId={desk.activeDeviceId} board={board} />

        <div className="md-side__user">
          <span className="md-avatar" aria-hidden="true">
            {(operator || "M").slice(0, 2).toUpperCase()}
          </span>
          <span className="md-side__who">
            <strong>{operator || "Operator"}</strong>
            <span className="md-side__state">
              <span className={`md-status__dot ${dot}`} />
              {statusLabel}
              {board ? ` · ${board}` : ""}
              {temp}
            </span>
          </span>
          <PwaInstallButton />
          <button className="md-iconbtn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <Icon name="signout" size={18} />
          </button>
        </div>
      </aside>

        {/* Remounting on the active board hands every view a fresh, routed session. */}
        <main className="md-main" key={desk.activeDeviceId ?? "direct"}>
          {desk.ready ? (
            <>
              {/* Chat stays mounted so switching views never drops a live session. */}
              <div className="md-fill" style={{ display: active === "chat" ? "block" : "none" }}>
                <ChatView />
              </div>
              {active === "machine" ? (
                <MachineView
                  deviceId={desk.activeDeviceId}
                  boardEmu={
                    // Orin is a real AWS VM that sometimes hello's as emu; never
                    // shut its terminal/files affordances for that mis-flag.
                    desk.activeDevice && isJudgeBoard(desk.activeDevice)
                      ? false
                      : (desk.activeDevice?.board_emu ?? false)
                  }
                />
              ) : null}
              {active === "board" ? <BoardView info={desk.info} health={desk.health} /> : null}
              {active === "library" ? <LibraryView onOpenChat={() => setView("chat")} /> : null}
              {active === "fleet" && pairing ? (
                <PairWizard
                  onExit={() => {
                    setPairing(false);
                    // Leave /pair behind once the wizard closes.
                    if (window.location.pathname !== "/dashboard") {
                      window.history.replaceState(null, "", "/dashboard");
                      document.title = "Desk · MetaDesk";
                    }
                    void desk.refresh();
                  }}
                />
              ) : null}
              {active === "fleet" && !pairing ? (
                <FleetView
                  devices={desk.devices}
                  activeId={desk.activeDeviceId}
                  onSelect={desk.selectDevice}
                  onClaim={desk.claimDevice}
                  onSetup={() => setPairing(true)}
                />
              ) : null}
            </>
          ) : (
            <p className="md-muted">Connecting…</p>
          )}
        </main>
    </div>
  );
}

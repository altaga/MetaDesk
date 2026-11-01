"use client";

import { useEffect, useState } from "react";
import { onGuide, takePendingTab } from "@/features/nova/guideBus";
import { TabList } from "@/ui/TabList";
import { BrowserView } from "./BrowserView";
import { FilesView } from "./FilesView";
import { JobsPane } from "./JobsPane";
import { MissionsPane } from "./MissionsPane";
import { TerminalPane } from "./TerminalPane";

type MachineTab = "files" | "terminal" | "agents" | "missions" | "preview";

const TABS: Array<{ id: MachineTab; label: string }> = [
  { id: "files", label: "Files" },
  { id: "terminal", label: "Terminal" },
  { id: "agents", label: "Agents" },
  { id: "missions", label: "Missions" },
  { id: "preview", label: "Preview" },
];

type MachineViewProps = {
  /** The active board id; the terminal trades it for a shell. */
  deviceId?: string | null;
  /** Emulated boards have no shell, so the terminal stays shut. */
  boardEmu?: boolean;
};

/** Machine: the board's desk root, a shell, its background agents, and its Chromium. */
export function MachineView({ deviceId = null, boardEmu = false }: MachineViewProps) {
  const [tab, setTab] = useState<MachineTab>(() => takePendingTab() ?? "files");

  // Nova may ask for a tab while this view is already open.
  useEffect(
    () =>
      onGuide((request) => {
        if (request.kind === "machine_tab") {
          takePendingTab();
          setTab(request.tab);
        }
      }),
    [],
  );

  return (
    <section className="md-page md-page--wide">
      <div className="md-viewhead">
        <div>
          <h1>Machine</h1>
          <p className="md-viewhead__note">
            The board surface for files, shell access, background agents, parallel missions, and preview.
          </p>
        </div>
        <TabList tabs={TABS} value={tab} onChange={setTab} label="Machine" />
      </div>

      {/* Files stays mounted so the open directory and file survive a tab switch. */}
      <div hidden={tab !== "files"} data-guide="files">
        <FilesView visible={tab === "files"} />
      </div>
      {/* The shell lives only while its tab is open: leaving it closes the pty. */}
      {tab === "terminal" ? (
        <div data-guide="terminal">
          <TerminalPane deviceId={deviceId} disabled={boardEmu} />
        </div>
      ) : null}
      {tab === "agents" ? <JobsPane /> : null}
      {tab === "missions" ? <MissionsPane /> : null}
      {tab === "preview" ? (
        <div data-guide="preview">
          <BrowserView />
        </div>
      ) : null}
    </section>
  );
}

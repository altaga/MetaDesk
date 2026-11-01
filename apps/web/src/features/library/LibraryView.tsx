"use client";

import { useEffect, useState } from "react";
import { seedComposer } from "@/features/desk/composerSeed";
import { onGuide, takePendingLibraryTab, type LibraryTab } from "@/features/nova/guideBus";
import { TabList } from "@/ui/TabList";
import { ExpertsCard } from "./ExpertsCard";
import { MemoryCard } from "./MemoryCard";
import { VaultCard } from "./VaultCard";

type Props = {
  /** Switch the desk back to the chat view (used when an expert is picked). */
  onOpenChat?: () => void;
};

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "secrets", label: "Secrets" },
  { id: "experts", label: "Experts" },
  { id: "memory", label: "Memory" },
];

/**
 * Library: the operator's keychain, and the board's growing knowledge. One
 * shelf at a time, so each list and its form get the room they need.
 */
export function LibraryView({ onOpenChat }: Props) {
  const [tab, setTab] = useState<LibraryTab>(() => takePendingLibraryTab() ?? "secrets");

  // Nova can point at a shelf while the Library is already open.
  useEffect(
    () =>
      onGuide((request) => {
        if (request.kind === "library_tab") {
          takePendingLibraryTab();
          setTab(request.tab);
        }
      }),
    [],
  );

  return (
    <section className="md-page md-library-page">
      <div className="md-viewhead">
        <div>
          <h1>Library</h1>
          <p className="md-viewhead__note">
            The board&apos;s durable knowledge: execution secrets, callable experts, and memory every chat reads.
          </p>
        </div>
        <TabList tabs={TABS} value={tab} onChange={setTab} label="Library" />
      </div>

      <div className="md-library-shelf">
        {tab === "secrets" ? <VaultCard /> : null}
        {tab === "experts" ? (
          <ExpertsCard
            onUse={(prompt) => {
              seedComposer(prompt);
              onOpenChat?.();
            }}
          />
        ) : null}
        {tab === "memory" ? <MemoryCard /> : null}
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeskShell } from "@/features/desk/DeskShell";
import { getSessionToken } from "@/lib/auth-cookie";

export const metadata: Metadata = { title: "Set up a board" };
export const dynamic = "force-dynamic";

export default async function PairPage() {
  // Confirming the Pair ID claims the board for the signed-in account.
  if (!(await getSessionToken())) redirect("/login");
  // A direct link to board setup: the desk, opened on Fleet with the wizard running.
  return <DeskShell startPairing />;
}

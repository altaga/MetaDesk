import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeskShell } from "@/features/desk/DeskShell";
import { getSessionToken } from "@/lib/auth-cookie";

export const metadata: Metadata = { title: "Desk" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login");
  return <DeskShell />;
}

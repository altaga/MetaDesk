import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { getSessionToken } from "@/lib/auth-cookie";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // A live session never sees the form again: straight back to the desk.
  if (await getSessionToken()) redirect("/dashboard");
  return <LoginScreen />;
}

import { Landing } from "@/features/landing/Landing";
import { getSessionToken } from "@/lib/auth-cookie";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const signedIn = Boolean(await getSessionToken());
  return <Landing signedIn={signedIn} />;
}

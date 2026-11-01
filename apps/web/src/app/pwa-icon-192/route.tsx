import { ImageResponse } from "next/og";
import { IconArtwork } from "@/features/pwa/IconArtwork";

export async function GET() {
  return new ImageResponse(<IconArtwork size={192} label="" />, {
    width: 192,
    height: 192,
  });
}

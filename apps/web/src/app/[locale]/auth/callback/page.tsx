import { OAuthCallback } from "@/components/auth/OAuthCallback";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.callback.title");

export default function Page() {
  return <OAuthCallback />;
}

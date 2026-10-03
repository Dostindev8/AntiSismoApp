import { privatePageMetadata } from "@/lib/page-meta";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { SessionsPanel } from "@/components/account/SessionsPanel";

export const generateMetadata = privatePageMetadata("account.sessionsPage.title");

export default function Page() {
  return (
    <RequireAuth>
      <SessionsPanel />
    </RequireAuth>
  );
}

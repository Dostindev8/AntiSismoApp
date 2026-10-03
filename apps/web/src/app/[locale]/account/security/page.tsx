import { privatePageMetadata } from "@/lib/page-meta";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { SecurityPanel } from "@/components/account/SecurityPanel";

export const generateMetadata = privatePageMetadata("account.securityPage.title");

export default function Page() {
  return (
    <RequireAuth>
      <SecurityPanel />
    </RequireAuth>
  );
}

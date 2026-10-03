import { AccountOverview } from "@/components/account/AccountOverview";
import { privatePageMetadata } from "@/lib/page-meta";
import { RequireAuth } from "@/components/auth/RequireAuth";

export const generateMetadata = privatePageMetadata("account.title");

export default function Page() {
  return (
    <RequireAuth>
      <AccountOverview />
    </RequireAuth>
  );
}

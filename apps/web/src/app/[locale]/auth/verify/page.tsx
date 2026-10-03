import { VerifyEmail } from "@/components/auth/VerifyEmail";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.verify.title");

export default function Page() {
  return <VerifyEmail />;
}

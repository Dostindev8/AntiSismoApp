import { ResetForm } from "@/components/auth/ResetForm";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.reset.title");

export default function Page() {
  return <ResetForm />;
}

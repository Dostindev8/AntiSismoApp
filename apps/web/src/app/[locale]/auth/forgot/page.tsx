import { ForgotForm } from "@/components/auth/ForgotForm";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.forgot.title");

export default function Page() {
  return <ForgotForm />;
}

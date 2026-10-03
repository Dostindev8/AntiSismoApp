import { LoginForm } from "@/components/auth/LoginForm";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.login.title");

export default function Page() {
  return <LoginForm />;
}

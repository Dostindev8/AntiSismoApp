import { RegisterForm } from "@/components/auth/RegisterForm";
import { privatePageMetadata } from "@/lib/page-meta";

export const generateMetadata = privatePageMetadata("auth.register.title");

export default function Page() {
  return <RegisterForm />;
}

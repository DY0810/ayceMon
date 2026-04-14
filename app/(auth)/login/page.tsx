import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Log in · ayceMon",
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}

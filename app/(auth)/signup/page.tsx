import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Sign up · ayceMon",
};

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}

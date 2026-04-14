import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Sign up · ayceMon",
};

// Mirrors /login — forward `?next=` through to the form so invite-link
// signups land back on /join after email confirmation.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="signup" next={next} />;
}

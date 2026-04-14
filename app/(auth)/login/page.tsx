import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Log in · ayceMon",
};

// Next 16 async `searchParams` prop — read the `next` query param from the
// URL and forward it to the form so post-login redirect lands back on the
// caller's intended destination (e.g. /join?token=… from an invite link).
// Same-origin validation happens inside the form component.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} />;
}

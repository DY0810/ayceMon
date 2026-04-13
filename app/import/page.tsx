import { requireUser } from "@/lib/auth/require-user";

import { ImportClient } from "./import-client";

export default async function ImportPage() {
  // Gate: only signed-in users can see this page.
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <h1 className="font-[var(--font-display)] text-3xl font-semibold tracking-tight text-[#191c1f] dark:text-white sm:text-4xl">
        Import Guest Meals
      </h1>
      <p className="mt-2 text-[#505a63] dark:text-[#8d969e]">
        These meals need a restaurant picked before they can be saved to your
        account.
      </p>
      <div className="mt-8">
        <ImportClient />
      </div>
    </main>
  );
}

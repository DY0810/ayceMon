import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-full border border-[rgba(25,28,31,0.12)] bg-white px-5 text-[0.9375rem] tracking-[0.01em] text-[#191c1f] transition-colors outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#191c1f] placeholder:text-[#8d969e] focus-visible:border-[#191c1f] focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#f4f4f4] disabled:opacity-60 aria-invalid:border-[#e23b4a] dark:bg-[#191c1f] dark:text-white dark:border-white/15 dark:focus-visible:border-white",
        className
      )}
      {...props}
    />
  )
}

export { Input }

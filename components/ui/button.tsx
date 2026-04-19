import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent whitespace-nowrap font-medium tracking-[0.01em] transition-opacity transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-[#191c1f]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[#e23b4a] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[#191c1f] text-white border-transparent hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)] [a]:hover:bg-[color:var(--accent)] [a]:hover:text-[color:var(--accent-foreground)]",
        outline:
          "bg-transparent text-[#191c1f] border-2 border-[#191c1f] hover:bg-[#191c1f] hover:text-white aria-expanded:bg-[#191c1f] aria-expanded:text-white dark:text-white dark:border-white dark:hover:bg-white dark:hover:text-[#191c1f]",
        secondary:
          "bg-[#f4f4f4] text-[#191c1f] border-transparent hover:opacity-85 dark:bg-[#262a2e] dark:text-white",
        ghost:
          "bg-transparent text-[#191c1f] hover:bg-[#f4f4f4] aria-expanded:bg-[#f4f4f4] dark:text-white dark:hover:bg-[#262a2e]",
        destructive:
          "bg-[#e23b4a] text-white border-transparent hover:opacity-85",
        link:
          "bg-transparent text-[#191c1f] underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default:
          "h-11 gap-2 px-8 text-[0.9375rem] has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6",
        xs:
          "h-8 gap-1 px-4 text-xs has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3",
        sm:
          "h-9 gap-1.5 px-6 text-sm has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-3.5",
        lg:
          "h-14 gap-2 px-10 text-base has-data-[icon=inline-end]:pr-8 has-data-[icon=inline-start]:pl-8",
        icon: "size-11",
        "icon-xs": "size-8 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

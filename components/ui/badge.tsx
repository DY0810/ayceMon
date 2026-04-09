import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-3 text-[11px] font-medium tracking-wide whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[#191c1f]/40 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-[#191c1f] text-white [a]:hover:opacity-85 dark:bg-white dark:text-[#191c1f]",
        secondary:
          "bg-[#f4f4f4] text-[#191c1f] [a]:hover:opacity-85 dark:bg-[#262a2e] dark:text-white",
        destructive:
          "bg-[#e23b4a] text-white [a]:hover:opacity-85",
        outline:
          "border border-[#191c1f] text-[#191c1f] bg-transparent [a]:hover:bg-[#f4f4f4] dark:border-white dark:text-white",
        ghost:
          "text-[#191c1f] hover:bg-[#f4f4f4] dark:text-white dark:hover:bg-[#262a2e]",
        link:
          "text-[#191c1f] underline-offset-4 hover:underline dark:text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
    </SliderPrimitive.Root>
  )
}

function SliderControl({
  className,
  ...props
}: SliderPrimitive.Control.Props) {
  return (
    <SliderPrimitive.Control
      data-slot="slider-control"
      className={cn(
        "relative flex h-11 w-full items-center",
        className
      )}
      {...props}
    />
  )
}

function SliderTrack({
  className,
  ...props
}: SliderPrimitive.Track.Props) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn(
        "relative h-2 w-full grow overflow-hidden rounded-full bg-[#f4f4f4] dark:bg-[#262a2e]",
        className
      )}
      {...props}
    />
  )
}

function SliderIndicator({
  className,
  ...props
}: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      data-slot="slider-indicator"
      className={cn("absolute h-full bg-[#191c1f] transition-all dark:bg-white", className)}
      {...props}
    />
  )
}

function SliderThumb({
  className,
  ...props
}: SliderPrimitive.Thumb.Props) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        "block size-5 rounded-full border-2 border-[#191c1f] bg-white transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[#191c1f]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white data-dragging:scale-110 disabled:pointer-events-none disabled:opacity-50 dark:border-white dark:bg-[#191c1f] dark:focus-visible:ring-offset-[#191c1f]",
        className
      )}
      {...props}
    />
  )
}

function SliderValue({
  className,
  ...props
}: SliderPrimitive.Value.Props) {
  return (
    <SliderPrimitive.Value
      data-slot="slider-value"
      className={cn("text-sm font-medium tabular-nums", className)}
      {...props}
    />
  )
}

export { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb, SliderValue }

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type GlassButtonProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
};

function GlassButton({
  asChild = false,
  className,
  ...props
}: GlassButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="glass-button"
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full border border-foreground/10 bg-background/35 text-sm font-medium text-foreground shadow-[inset_0_1px_1px_rgb(255_255_255/0.36),0_10px_28px_rgb(0_0_0/0.18)] backdrop-blur-xl backdrop-saturate-150",
        "transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { GlassButton };

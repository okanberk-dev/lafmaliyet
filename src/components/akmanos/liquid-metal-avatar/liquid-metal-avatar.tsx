"use client";

import { LiquidMetal, type LiquidMetalProps } from "@paper-design/shaders-react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  createContext,
  type ComponentProps,
  type ImgHTMLAttributes,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { cn } from "@/components/akmanos/lib/cn";

const avatarVariants = cva(
  "relative flex shrink-0 items-center justify-center overflow-visible rounded-full bg-transparent",
  {
    variants: {
      size: {
        sm: "size-8",
        md: "size-12",
        lg: "size-16",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const innerVariants = cva(
  "absolute z-[1] overflow-hidden rounded-full bg-background shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  {
    variants: {
      size: {
        sm: "inset-px",
        md: "inset-0.5",
        lg: "inset-[3px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ShaderProps = Omit<LiquidMetalProps, "className" | "style" | "shape">;

export type LiquidMetalAvatarProps = ComponentProps<"div"> &
  Partial<ShaderProps> &
  VariantProps<typeof avatarVariants>;

type AvatarCtx = {
  imageStatus: "idle" | "loaded" | "error";
  setImageStatus: (status: "idle" | "loaded" | "error") => void;
};

const AvatarContext = createContext<AvatarCtx | null>(null);

export function LiquidMetalAvatar({
  size = "md",
  className,
  children,
  speed = 0.28,
  repetition = 4,
  softness = 0.62,
  shiftRed = 0.3,
  shiftBlue = 0.3,
  distortion = 0,
  contour = 0,
  angle = 45,
  scale = 8,
  offsetX = 0.1,
  offsetY = -0.1,
  colorBack = "#c8c8ca",
  colorTint = "#ffffff",
  ...props
}: LiquidMetalAvatarProps) {
  const [imageStatus, setImageStatus] = useState<"idle" | "loaded" | "error">(
    "idle",
  );
  const ctx = useMemo(
    () => ({ imageStatus, setImageStatus }),
    [imageStatus],
  );

  return (
    <div
      data-component="liquid-metal-avatar"
      data-slot="liquid-metal-avatar"
      className={cn(avatarVariants({ size }), className)}
      {...props}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <LiquidMetal
          className="absolute inset-0 size-full"
          shape="none"
          speed={speed}
          repetition={repetition}
          softness={softness}
          shiftRed={shiftRed}
          shiftBlue={shiftBlue}
          distortion={distortion}
          contour={contour}
          angle={angle}
          scale={scale}
          offsetX={offsetX}
          offsetY={offsetY}
          colorBack={colorBack}
          colorTint={colorTint}
        />
      </div>
      <AvatarContext.Provider value={ctx}>
        <div
          data-slot="avatar"
          className={cn(
            innerVariants({ size }),
            "flex items-center justify-center bg-chart-bg",
          )}
        >
          {children}
        </div>
      </AvatarContext.Provider>
    </div>
  );
}

export function AvatarImage({
  className,
  alt = "",
  onError,
  onLoad,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const ctx = useContext(AvatarContext);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-slot="avatar-image"
      alt={alt}
      className={cn(
        "pointer-events-none absolute inset-0 aspect-square size-full rounded-full object-cover select-none",
        className,
      )}
      onError={(event) => {
        setFailed(true);
        ctx?.setImageStatus("error");
        onError?.(event);
      }}
      onLoad={(event) => {
        ctx?.setImageStatus("loaded");
        onLoad?.(event);
      }}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  children,
  ...props
}: ComponentProps<"span"> & { children?: ReactNode }) {
  const ctx = useContext(AvatarContext);
  const visible = !ctx || ctx.imageStatus !== "loaded";

  if (!visible) return null;

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-chart-bg text-xs font-medium text-chart-muted",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

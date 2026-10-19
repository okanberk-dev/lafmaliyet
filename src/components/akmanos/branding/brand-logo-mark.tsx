import { LafTile } from "@/components/brand";

/** AkmanOS kabuğundaki logo yuvası: L'Af uygulama ikonu */
export function BrandLogoMark({ className }: { src?: string; alt?: string; className?: string }) {
  return <LafTile className={className ?? "size-8 rounded-lg"} />;
}

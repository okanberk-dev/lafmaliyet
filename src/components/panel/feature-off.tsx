import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { BRANCH_PARAM } from "@/lib/branches";

/**
 * Seçili şubede kullanılmayan özelliğin ekranı (şube özellikleri, src/lib/branch-features.ts; docs/SUBE.md › Şube
 * özellikleri): "Karaoke bu şubede kullanılmıyor" ve özelliğin açık olduğu şubeler. Şubesine kilitli olmayan kişi
 * (yönetici, şubesiz personel) o şubeyi tek dokunuşla seçer: düğme sayfanın adresini `?sube=` ile açar, seçici çereze
 * benimsetir (branch-picker.tsx). Kilitli personele düğme yok. Hiçbir şubede açık değilse yöneticiye Şubeler'in yolu.
 * Sunucu bileşeni; düğmeler bağlantıdır (44 px).
 */
export function FeatureOff({
  title,
  path,
  on,
  locked,
  admin,
}: {
  /** "Karaoke bu şubede kullanılmıyor" */
  title: string;
  /** Sayfanın adresi (düğme `?sube=` ile bunu açar) */
  path: string;
  /** Özelliğin açık olduğu etkin şubeler */
  on: readonly { id: string; name: string }[];
  /** Şubesine kilitli personel: başka şubeyi seçemez */
  locked: boolean;
  admin: boolean;
}) {
  const names = on.map((b) => b.name).join(", ");
  const description = on.length
    ? `${names} ${on.length > 1 ? "şubelerinde" : "şubesinde"} açık.${locked ? "" : " O şubeyi seçince burada görünür."}`
    : admin
      ? "Hiçbir şubede açık değil. Şubeler › Şube ayarları › Özellikler'den açılır."
      : "Hiçbir şubede açık değil.";
  const action =
    !locked && on.length ? (
      <>
        {on.map((b) => (
          <ButtonLink key={b.id} href={`${path}?${BRANCH_PARAM}=${encodeURIComponent(b.id)}`} variant="secondary" className="min-h-11">
            {b.name}
          </ButtonLink>
        ))}
      </>
    ) : !on.length && admin ? (
      <ButtonLink href="/panel/subeler" variant="secondary" className="min-h-11">
        Şubeler
      </ButtonLink>
    ) : undefined;
  return <EmptyState title={title} description={description} action={action} />;
}

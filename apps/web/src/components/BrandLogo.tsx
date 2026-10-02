import Image from "next/image";

/**
 * Logo oficial intacto (sin recolorear ni redibujar, ADR-0005) sobre placa clara con zona de seguridad
 * del 25 % del alto. `object-contain` garantiza que nunca se recorte ni se distorsione.
 */
export function BrandLogo({ alt, height, priority = false }: { alt: string; height: number; priority?: boolean }) {
  const pad = Math.round(height * 0.25);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-light-bg shadow-lg shadow-black/30"
      style={{ padding: pad }}
    >
      <Image
        src="/brand/logo-fullcolor.webp"
        alt={alt}
        width={480}
        height={469}
        priority={priority}
        sizes={`${height}px`}
        className="h-auto object-contain"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}

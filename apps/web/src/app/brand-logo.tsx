import Image from "next/image";
import roleSaveLogo from "@/assets/rolesave-logo.png";

export function BrandLogo({
  className,
  preload = false,
  sizes = "160px",
}: {
  className: string;
  preload?: boolean;
  sizes?: string;
}) {
  return (
    <Image
      alt="RoleSave"
      className={className}
      preload={preload}
      sizes={sizes}
      src={roleSaveLogo}
    />
  );
}

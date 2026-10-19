import { useEffect, useState } from "react";

export type ProfileMenuInlineAlign = "start" | "end" | "center";

const MOBILE_MENU_QUERY = "(max-width: 639px)";

export function resolveProfileMenuInlineAlign(
  isMobile: boolean,
  isRtl: boolean,
): ProfileMenuInlineAlign {
  if (isMobile) {
    return "center";
  }

  return isRtl ? "end" : "start";
}

export function useProfileMenuInlineAlign(
  menuAlign: "auto" | ProfileMenuInlineAlign = "auto",
): ProfileMenuInlineAlign {
  const [resolvedAlign, setResolvedAlign] = useState<ProfileMenuInlineAlign>(
    menuAlign === "auto" ? "start" : menuAlign,
  );

  useEffect(() => {
    if (menuAlign !== "auto") {
      setResolvedAlign(menuAlign);
      return;
    }

    const mobileQuery = window.matchMedia(MOBILE_MENU_QUERY);

    const update = () => {
      const isRtl = document.documentElement.dir === "rtl";
      setResolvedAlign(
        resolveProfileMenuInlineAlign(mobileQuery.matches, isRtl),
      );
    };

    update();
    mobileQuery.addEventListener("change", update);

    const dirObserver = new MutationObserver(update);
    dirObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
    });

    return () => {
      mobileQuery.removeEventListener("change", update);
      dirObserver.disconnect();
    };
  }, [menuAlign]);

  return menuAlign === "auto" ? resolvedAlign : menuAlign;
}

export function profileMenuInlineAlignClasses(
  align: ProfileMenuInlineAlign,
  menuPlacement: "bottom" | "top",
) {
  const vertical =
    menuPlacement === "top"
      ? "bottom-[calc(100%+0.5rem)]"
      : "top-[calc(100%+0.5rem)]";

  const horizontal =
    align === "center"
      ? "left-1/2 right-auto -translate-x-1/2"
      : align === "end"
        ? "right-0 left-auto translate-x-0"
        : "left-0 right-auto translate-x-0";

  const origin =
    menuPlacement === "top"
      ? align === "center"
        ? "origin-bottom"
        : align === "end"
          ? "origin-bottom-right"
          : "origin-bottom-left"
      : align === "center"
        ? "origin-top"
        : align === "end"
          ? "origin-top-right"
          : "origin-top-left";

  return cnJoin(vertical, horizontal, origin);
}

function cnJoin(...values: string[]) {
  return values.join(" ");
}

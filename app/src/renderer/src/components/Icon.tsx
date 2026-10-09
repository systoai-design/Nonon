import { ICONS, type IconName } from "./icons-data";

export type { IconName };

/**
 * The brand icon set (assets from the NONON brand pack, inlined so no file URL is needed).
 * Default colour is the accessible orange (--nonon-orange-ink, 6:1 on white). `tone="current"` follows the text colour,
 * `tone="bright"` is the logo orange and is for dark surfaces only (it is 2.7:1 on white).
 * Pass `title` only when the icon carries meaning that no nearby text already gives.
 */
export function Icon({ name, size = 20, tone = "accent", className, title }: { name: IconName; size?: number; tone?: "accent" | "current" | "bright"; className?: string; title?: string }) {
  return (
    <svg
      className={`icon icon-${tone}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

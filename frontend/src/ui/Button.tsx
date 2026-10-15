import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "outline" | "subtle";
  size?: "sm" | "md";
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props) {
  const sizeClass = size === "sm" ? "btn--sm" : "";
  const classes = `btn btn--${variant} ${sizeClass} ${className}`.trim();
  return <button type={type} className={classes} {...rest} />;
}

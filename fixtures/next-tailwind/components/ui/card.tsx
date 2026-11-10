import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border bg-card p-4 shadow-card", className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-medium", className)} {...props} />
}

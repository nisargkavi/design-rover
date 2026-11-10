export function Placeholder({ label = "Placeholder" }: { label?: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed text-muted-foreground">
      {label}
    </div>
  )
}

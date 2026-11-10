import { Button } from "@/components/ui/button"
import { Placeholder } from "@/components/placeholder"

export default function Page() {
  return (
    <>
      <Header />
      <section className="mx-auto max-w-5xl px-6 py-16">
        {/* TODO: replace with production image */}
        <Placeholder label="Hero visual" />
        <h1>Product</h1>
        <Button size="lg">Get started</Button>
      </section>
    </>
  )
}

function Header() {
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <span>Acme</span>
      <Button variant="ghost">Sign in</Button>
    </header>
  )
}

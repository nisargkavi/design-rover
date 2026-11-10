import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"

export default function BillingPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <section className="space-y-3">
        <h1 className="text-xl">Billing</h1>
        <p className="text-muted-foreground">Invoices and plan</p>
        <Card>
          <CardTitle>Plan</CardTitle>
          <Button>Manage</Button>
        </Card>
      </section>
    </main>
  )
}

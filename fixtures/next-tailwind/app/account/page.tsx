import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <section className="space-y-3">
        <h1 className="text-xl">Account</h1>
        <p className="text-muted-foreground">Security and login</p>
        <Card>
          <CardTitle>Password</CardTitle>
          <Button>Update</Button>
        </Card>
      </section>
    </main>
  )
}

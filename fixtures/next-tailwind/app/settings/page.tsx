import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <section className="space-y-3">
        <h1 className="text-xl">Settings</h1>
        <p className="text-muted-foreground">Profile preferences</p>
        <Card>
          <CardTitle>Account</CardTitle>
          <Button>Save</Button>
        </Card>
      </section>
    </main>
  )
}

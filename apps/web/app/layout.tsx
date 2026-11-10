import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "Design Rover",
  description: "Your code is the source. Design Rover is the understanding of it.",
}

const links = [
  ["/", "Overview"],
  ["/components", "Components"],
  ["/tokens", "Tokens"],
  ["/patterns", "Patterns"],
  ["/conventions", "Conventions"],
  ["/intents", "Intents"],
  ["/exceptions", "Exceptions"],
  ["/history", "History"],
] as const

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&family=Newsreader:opsz,wght@6..72,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="shell">
          <aside className="side">
            <p className="brand">Design Rover</p>
            <nav className="nav">
              {links.map(([href, label]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  )
}

export const metadata = {
  title: 'Osiris — House Cleaning',
  description: 'House cleaning operations platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

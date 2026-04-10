export const metadata = {
  title: 'Osiris — Window Washing',
  description: 'Window washing operations platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

// scripts/seed-brain-channels.ts
// One-time script to queue initial YouTube channels for Brain ingestion.
// Run with: npx tsx scripts/seed-brain-channels.ts
//
// SETUP REQUIRED:
// 1. Get a YouTube Data API v3 key from Google Cloud Console
// 2. Set YOUTUBE_API_KEY in .env.local
// 3. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
//
// To find a channel ID from a YouTube handle (@username):
//   curl "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=jazminetates&key=$YOUTUBE_API_KEY"

import { config } from 'dotenv'
config({ path: '.env.local' })

import { queueChannel } from '../lib/brain/ingest'

const CHANNELS = [
  // Jazmine Tates — CEO Cleaning Academy, $80K/mo cleaning biz, "No Mop Method"
  { id: 'UCLLSokiR2CvvZY7i-W-VWoQ', name: 'Jazmine Tates' },

  // Angela Brown — Ask a House Cleaner, 323K subs, 25 years experience
  { id: 'UC8OUzZ0rKHOUZ19em4cEXyQ', name: 'Angela Brown Cleaning' },

  // Cleaning Launch — Rick Brown, 7-figure commercial cleaning exit
  { id: 'UCYUuZxkwhurTadbwGNK5DXA', name: 'Cleaning Launch' },

  // The Professional Cleaner — Bethany Jean, 20+ years
  { id: 'UC1ruYV63FeDonwQODFojwPQ', name: 'The Professional Cleaner' },
]

async function main() {
  console.log('Seeding Brain with YouTube channels...\n')

  if (!process.env.YOUTUBE_API_KEY) {
    console.error('ERROR: YOUTUBE_API_KEY not set. Add it to .env.local')
    process.exit(1)
  }

  for (const channel of CHANNELS) {
    try {
      const count = await queueChannel(channel.id, channel.name)
      console.log(`  ✓ ${channel.name}: ${count} videos queued`)
    } catch (err) {
      console.error(`  ✗ ${channel.name}: FAILED -`, err)
    }
  }

  console.log('\nDone. Videos will be processed by the brain-ingest cron.')
  console.log('Or trigger manually: curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/brain-ingest')
}

main().catch(console.error)

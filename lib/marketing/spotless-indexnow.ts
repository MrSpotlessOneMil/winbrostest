import sitemap from "@/app/spotless/sitemap"

/**
 * IndexNow (indexnow.org): push URLs straight into Bing/Yandex/Seznam/Naver
 * instead of waiting for a crawl. DuckDuckGo, Yahoo, Ecosia, and ChatGPT web
 * search all read Bing's index, so this is the fast path onto all of them.
 * The key is public by protocol design — engines verify ownership by fetching
 * /<key>.txt from the host (served from public/spotless/ via the domain rewrite).
 */
export const INDEXNOW_KEY = "f03bb9b68e12a32e4b6086b074b59d0c"

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
const BASE_URL = "https://spotlessscrubbers.org"

export interface IndexNowResult {
  submitted: number
  status: number
}

/**
 * Submit every Spotless page in one IndexNow batch (protocol max is 10,000).
 * Reuses the sitemap so area/service/combo/blog pages stay in sync automatically.
 */
export async function submitAllUrlsToIndexNow(): Promise<IndexNowResult> {
  const entries = await sitemap()
  const urlList = entries.map((entry) => entry.url)

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(BASE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  })

  return { submitted: urlList.length, status: res.status }
}

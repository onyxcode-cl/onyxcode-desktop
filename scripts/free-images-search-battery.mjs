/** Manual, bounded capture. Unit tests only read the saved responses; they never run this script. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = resolve(root, 'src/main/documents/fixtures-free-images/search-battery')
const selected = process.argv[3]?.split(',')
const cases = JSON.parse(await readFile(resolve(dir, '../search-battery-queries.json'), 'utf8')).filter(
  (item) => !selected || selected.includes(item.id)
)
const mode = process.argv[2]
if (!['before', 'after', 'fallback'].includes(mode)) throw new Error('Use before, after or fallback; at most 14 requests per run.')
await mkdir(dir, { recursive: true })
for (const item of cases) {
  const queries = mode === 'fallback' ? item.fallback : item.queries
  for (const [index, query] of queries.entries()) {
    if (process.argv[4] && Number(process.argv[4]) !== index + 1) continue
    const file = resolve(dir, `${item.id}-${mode}-${index + 1}.json`)
    try {
      await access(file)
      continue
    } catch {
      /* Never overwrite an existing capture. */
    }
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      maxlag: '5',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata|sha1',
      iiurlwidth: '1280',
      iiextmetadatalanguage: 'en',
      generator: 'search',
      gsrnamespace: '6',
      gsrwhat: 'text',
      gsrsearch: mode === 'before' ? query : `${query} filetype:bitmap`,
      gsrlimit: mode === 'before' ? '6' : '12',
      ...(mode === 'before' ? {} : { gsrsort: 'relevance' })
    })
    const url = `https://commons.wikimedia.org/w/api.php?${params}`
    const response = await fetch(url, {
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'Lazunox/free-images-battery (document photos)', Accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}; stop capture, do not retry in a loop.`)
    const body = await response.text()
    if (body.length > 2 * 1024 * 1024) throw new Error('Response over limit')
    const data = JSON.parse(body)
    if (data.error) throw new Error(JSON.stringify(data.error))
    await writeFile(file, JSON.stringify({ capturedAt: new Date().toISOString(), url, response: data }, null, 2) + '\n')
    console.log(`${item.id} ${mode} ${index + 1}: ${data.query?.pages?.length ?? 0} raw results`)
    await new Promise((done) => setTimeout(done, 300))
  }
}

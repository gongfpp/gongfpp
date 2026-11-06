import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const owner = 'gongfpp'
const api = 'https://api.github.com'
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'gongfpp-profile-stats',
}
if (token) headers.Authorization = `Bearer ${token}`

async function getJson(path) {
  const response = await fetch(`${api}${path}`, { headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 240)}`)
  }
  return response.json()
}

const profile = await getJson(`/users/${owner}`)
const repos = []
for (let page = 1; ; page += 1) {
  const batch = await getJson(`/users/${owner}/repos?type=owner&per_page=100&page=${page}`)
  repos.push(...batch)
  if (batch.length < 100) break
}

// Keep community catalog submissions separate from upstream project contributions.
// Add other catalog repositories here when they are listed under ecosystem participation.
const pluginCatalogs = [
  'awesome-dsh-plugin/awesome-dsh-plugin',
  'imsai-sh/awesome-deepseek-harness-plugins',
]
const contributionQuery = [
  `author:${owner} is:pr is:merged -user:${owner}`,
  ...pluginCatalogs.map((repo) => `-repo:${repo}`),
].join(' ')
const contributionData = await getJson(`/search/issues?q=${encodeURIComponent(contributionQuery)}&per_page=1`)
if (contributionData.incomplete_results || !Number.isSafeInteger(contributionData.total_count) || contributionData.total_count < 0) {
  throw new Error('GitHub search returned an incomplete or invalid contribution count')
}
const upstreamMergedPRs = contributionData.total_count

const metrics = [
  { label: 'STARS', value: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0), note: 'across public repositories' },
  { label: 'EXTERNAL PRs MERGED', value: upstreamMergedPRs, note: 'excluding plugin catalogs' },
  { label: 'PUBLIC REPOSITORIES', value: profile.public_repos, note: 'currently public' },
  { label: 'FOLLOWERS', value: profile.followers, note: 'public GitHub profile' },
]

const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const formatted = (value) => new Intl.NumberFormat('en-US').format(value)
const cards = metrics.map((metric, index) => {
  const x = 20 + index * 257
  return `
  <g transform="translate(${x} 18)">
    <rect width="243" height="112" rx="11" fill="#14212c" stroke="#2b4050" />
    <text x="17" y="30" fill="#e2edf4" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="0.4">${escapeXml(metric.label)}</text>
    <text x="17" y="70" fill="#9fe0cd" font-family="Segoe UI,Arial,sans-serif" font-size="31" font-weight="700">${escapeXml(formatted(metric.value))}</text>
    <text x="17" y="94" fill="#7f96a5" font-family="Segoe UI,Arial,sans-serif" font-size="10">${escapeXml(metric.note)}</text>
    <text x="218" y="28" text-anchor="end" fill="#59778a" font-family="Segoe UI,Arial,sans-serif" font-size="10">0${index + 1}</text>
  </g>`
}).join('')
const updated = new Date().toISOString().slice(0, 10)
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="148" viewBox="0 0 1050 148" role="img" aria-labelledby="title desc">
  <title id="title">GitHub public statistics for ${owner}</title>
  <desc id="desc">Stars across public repositories, merged external pull requests excluding listed plugin catalogs, public repositories, and followers. Updated ${updated}.</desc>
  <rect width="1050" height="148" rx="15" fill="#0f1821" stroke="#263947" />
  ${cards}
  <text x="1030" y="140" text-anchor="end" fill="#627988" font-family="Segoe UI,Arial,sans-serif" font-size="8">UPDATED ${updated} UTC · PUBLIC DATA</text>
</svg>
`

const output = resolve('profile-stats.svg')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, svg, 'utf8')
console.log(`Updated profile-stats.svg: ${metrics.map(({ label, value }) => `${label}=${formatted(value)}`).join(', ')}`)

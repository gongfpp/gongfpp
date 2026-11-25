import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Regenerates the merged-contribution block in README.md between the
// contributions markers. Curated project names, summaries and PR descriptions
// live in data/profile-contributions.json; PRs merged after the last curation
// appear automatically with their upstream title instead of breaking the table.

const api = 'https://api.github.com'
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'gongfpp-profile-stats',
}
if (token) headers.Authorization = `Bearer ${token}`

const manifestPath = resolve('data/profile-contributions.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const owner = manifest.owner || 'gongfpp'
const excludedRepos = manifest.excludedRepos || []
const projects = manifest.projects || {}

async function getJson(path) {
  const response = await fetch(`${api}${path}`, { headers })
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 240)}`)
  }
  return response.json()
}

const query = [
  `author:${owner} is:pr is:merged -user:${owner}`,
  ...excludedRepos.map((repo) => `-repo:${repo}`),
].join(' ')

const contributions = []
for (let page = 1; page <= 10; page += 1) {
  const data = await getJson(`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`)
  if (data.incomplete_results || !Number.isSafeInteger(data.total_count) || data.total_count < 0) {
    throw new Error('GitHub search returned an incomplete or invalid contribution count')
  }
  contributions.push(...data.items)
  if (data.items.length < 100) break
}

const rows = contributions.map((item) => ({
  repo: item.repository_url.split('/repos/')[1],
  number: item.number,
  title: item.title,
  mergedAt: item.closed_at,
  url: item.html_url,
}))
if (new Set(rows.map((row) => `${row.repo}#${row.number}`)).size !== rows.length) {
  throw new Error('GitHub search returned duplicate pull requests')
}

const grouped = new Map()
for (const row of rows) {
  if (!grouped.has(row.repo)) grouped.set(row.repo, [])
  grouped.get(row.repo).push(row)
}
for (const list of grouped.values()) list.sort((a, b) => b.number - a.number)

const orderedRepos = [
  ...Object.keys(projects).filter((repo) => grouped.has(repo)),
  ...[...grouped.keys()].filter((repo) => !projects[repo]).sort(),
]

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const escapeText = (value) => String(value).replaceAll('<', '&lt;').replaceAll('\n', ' ')

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

const table = [
  '| 项目 | 解决的问题与改进 | 已合并 PR |',
  '| --- | --- | --- |',
  ...orderedRepos.map((repo) => {
    const meta = projects[repo] || { name: repo.split('/')[1] }
    const count = grouped.get(repo).length
    const search = `https://github.com/${repo}/pulls?q=is%3Apr+author%3A${owner}+is%3Amerged`
    return `| [**${escapeCell(meta.name)}**](https://github.com/${repo}) | ${escapeCell(meta.summary || '—')} | [${count} merged ↗](${search}) |`
  }),
]

const details = orderedRepos.map((repo) => {
  const meta = projects[repo] || { name: repo.split('/')[1], prs: {} }
  const list = grouped.get(repo)
  const entries = list.map((row) => {
    const description = meta.prs?.[row.number]
    const text = description ? escapeText(description) : `${escapeText(row.title)}`
    return `- [#${row.number}](${row.url})：${text}`
  })
  return `### [${meta.name}](https://github.com/${repo}) · ${list.length} 个已合并\n\n${entries.join('\n')}`
})

const total = rows.length
const block = [
  `截至 **${today}（UTC+8）**，向 **${orderedRepos.length} 个外部项目**提交的 **${total} 个 PR 已合并**，涉及${manifest.topics}；不含自己的仓库及插件目录收录与维护。`,
  '',
  ...table,
  '',
  '<details>',
  `<summary>查看这 ${total} 个 PR 的具体贡献</summary>`,
  '',
  ...details.map((section) => `${section}\n`),
  '</details>',
].join('\n')

const readmePath = resolve('README.md')
const readme = await readFile(readmePath, 'utf8')
const start = '<!-- contributions:start -->'
const end = '<!-- contributions:end -->'
const startIndex = readme.indexOf(start)
const endIndex = readme.indexOf(end)
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error(`README.md is missing the ${start} / ${end} markers`)
}
const next = `${readme.slice(0, startIndex + start.length)}\n${block}\n${readme.slice(endIndex)}`

if (next === readme) {
  console.log(`Contributions unchanged: ${total} merged PRs across ${orderedRepos.length} projects`)
} else {
  await writeFile(readmePath, next, 'utf8')
  console.log(`Updated README.md contributions: ${total} merged PRs across ${orderedRepos.length} projects`)
}

const uncurated = rows.filter((row) => !projects[row.repo]?.prs?.[row.number])
if (uncurated.length > 0) {
  console.log(`Not yet described in ${manifestPath}: ${uncurated.map((row) => `${row.repo}#${row.number}`).join(', ')}`)
}

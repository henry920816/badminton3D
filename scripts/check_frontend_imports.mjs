// 快速檢查前端相對匯入是否存在，避免少複製一個檔案就整頁空白。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(project, 'frontend', 'src')
const files = []

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) walk(file)
    else if (/\.(js|jsx)$/.test(item.name)) files.push(file)
  }
}

walk(root)
let checked = 0
const missing = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const relativeImports = [
    ...source.matchAll(/\bfrom\s*['"](\.[^'"\n]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"](\.[^'"\n]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"\n]+)['"]\s*\)/g),
  ]
  for (const [, specifier] of relativeImports) {
    checked++
    const candidate = path.resolve(path.dirname(file), specifier)
    if (![candidate, candidate + '.js', candidate + '.jsx'].some(fs.existsSync)) {
      missing.push(`${path.relative(root, file)} → ${specifier}`)
    }
  }
}

if (missing.length) {
  console.error('找不到的前端匯入：\n' + missing.join('\n'))
  process.exitCode = 1
} else {
  console.log(`已檢查 ${files.length} 個前端檔案、${checked} 個相對匯入，路徑皆存在。`)
}

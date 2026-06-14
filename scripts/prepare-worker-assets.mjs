import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ignoreFilePath = join(process.cwd(), '.assetsignore')
const distDirectory = join(process.cwd(), 'dist')

const ignoredAssets = (await readFile(ignoreFilePath, 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && !line.includes('*') && !line.includes('/'))

await Promise.all(ignoredAssets.map((fileName) => rm(join(distDirectory, fileName), { force: true })))

#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const useNext = args.has('--next')

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
const countRaw = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
const count = Number.parseInt(countRaw, 10)

if (!Number.isFinite(count)) {
    console.error(`Invalid commit count: "${countRaw}"`)
    process.exit(1)
}

const build = useNext ? count + 1 : count
const buildText = String(build)
const filePath = path.join(root, 'frontend', 'src', 'editor', 'BuildNumber.js')

const source = fs.readFileSync(filePath, 'utf8')
const next = source.replace(
    /const\s+VOVKPLCEDITOR_VERSION_BUILD\s*=\s*['"][^'"]*['"]/,
    `const VOVKPLCEDITOR_VERSION_BUILD = '${buildText}'`
)

if (next === source) {
    if (!/const\s+VOVKPLCEDITOR_VERSION_BUILD\s*=/.test(source)) {
        console.error('Build number constant not found in BuildNumber.js')
        process.exit(1)
    }
    process.exit(0)
}

fs.writeFileSync(filePath, next)

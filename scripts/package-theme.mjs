import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const manifest = JSON.parse(await readFile(join(root, 'theme.json'), 'utf8'))
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) || !manifest.name || !manifest.version || !manifest.requires) {
  throw new Error('theme.json must contain a safe id, name, version and requires.')
}
await readFile(join(dist, 'index.html')) // Refuse to package an absent/incomplete build.

async function collect(directory) {
  const files = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const fullPath = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in dist: ${entry.name}`)
    if (entry.isDirectory()) files.push(...await collect(fullPath))
    else if (entry.isFile()) files.push({ name: `ui/${relative(dist, fullPath).split('\\').join('/')}`, data: await readFile(fullPath) })
  }
  return files
}

// Standard ZIP (DEFLATE + CRC-32), using Node built-ins so packaging needs no
// system zip command or additional archive dependency on Windows/macOS/Linux.
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let crc = i
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const entries = [{ name: 'theme.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, ...await collect(dist)]
if (entries.length > 65535) throw new Error('Too many files for a standard ZIP archive.')
const local = [], central = []
let offset = 0
for (const { name, data } of entries) {
  const filename = Buffer.from(name)
  const compressed = deflateRawSync(data, { level: 9 })
  const crc = crc32(data)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x800, 6) // UTF-8 names
  header.writeUInt16LE(8, 8) // DEFLATE
  header.writeUInt16LE(0x21, 12) // Fixed date: 1980-01-01 for repeatable archives
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(compressed.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(filename.length, 26)
  local.push(header, filename, compressed)
  const record = Buffer.alloc(46)
  record.writeUInt32LE(0x02014b50, 0)
  record.writeUInt16LE(20, 4)
  record.writeUInt16LE(20, 6)
  record.writeUInt16LE(0x800, 8)
  record.writeUInt16LE(8, 10)
  record.writeUInt16LE(0x21, 14)
  record.writeUInt32LE(crc, 16)
  record.writeUInt32LE(compressed.length, 20)
  record.writeUInt32LE(data.length, 24)
  record.writeUInt16LE(filename.length, 28)
  record.writeUInt32LE(offset, 42)
  central.push(record, filename)
  offset += header.length + filename.length + compressed.length
}
const directory = Buffer.concat(central)
if (offset + directory.length > 0xffffffff) throw new Error('Theme exceeds the standard ZIP size limit.')
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(directory.length, 12)
end.writeUInt32LE(offset, 16)
const output = join(root, 'release', `${manifest.id}.zip`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.concat([...local, directory, end]))
console.log(`${manifest.name} ${manifest.version}: ${entries.length} files -> ${output}`)

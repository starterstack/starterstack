import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import Current from './current.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function runMigrations({ log, abortSignal }) {
  const migrations = []

  const directories = await readdir(__dirname)

  for (const directory of directories.filter((x) => Number(x) >= 0)) {
    const files = await readdir(path.join(__dirname, directory))
    if (files.length !== 1) {
      throw new Error(`${directory} has multiple files, only 1 is supported`)
    }
    migrations.push({
      number: Number(directory),
      file: files.at(0)
    })
  }

  const current = Current({ abortSignal })
  const { number } = (await current.get()) ?? -1
  let total = 0

  for (const migration of migrations.sort((a, b) => a.number - b.number)) {
    if (migration.number <= number) continue

    const { migrate } = await import(
      path.join(__dirname, String(migration.number), migration.file)
    )

    await migrate({
      log,
      abortSignal,
      onProcessed(count) {
        total += count
        if (count > 0 && total % 200 === 0) {
          log.debug(
            `${migration.number}/${migration.file}: migrated ${total} item(s)`
          )
        }
      }
    })
    log.debug(
      `${migration.number}/${migration.file}: migrated ${total} item(s)`
    )
    await current.update(migration)
  }
  if (total > 0) {
    log.debug(`total migrated ${total} item(s)`)
  }
}

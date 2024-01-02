import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import Current from './current.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function runMigrations({ log, abortSignal }) {
  const migrations = []

  for (const directory of (await readdir(__dirname)).filter(
    (x) => Number(x) >= 0
  )) {
    migrations.push({
      number: Number(directory),
      file: (await readdir(path.join(__dirname, directory)))[0]
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

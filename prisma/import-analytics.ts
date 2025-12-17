import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

interface AnalyticsCsvRow {
  Филиал: string
  Клиент: string
  ИНН: string
  Дата: string
  КолвоПоЗаявке: string
  КолвоПоПлану: string
  КолвоПоФакту: string
  КолвоПоУбытию: string
}

function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  const cleaned = dateStr.trim()
  
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    if (!isNaN(date.getTime())) return date
  }
  
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (dateMatch) {
    const [, day, month, year] = dateMatch
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    if (!isNaN(date.getTime())) return date
  }
  
  const parsedDate = new Date(cleaned)
  return !isNaN(parsedDate.getTime()) ? parsedDate : null
}

function parseInteger(value: string): number {
  if (!value) return 0
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : num
}

const analyticsKey = (b: string, t: string, d: Date) => `${b}|${t}|${d.toISOString().split('T')[0]}`

async function main() {
  try {
    // Проверяем, нужно ли фильтровать по последним 3 месяцам
    const filterLast3Months = process.env.IMPORT_LAST_3_MONTHS === 'true'
    const dateThreshold = filterLast3Months ? new Date() : null
    if (dateThreshold) {
      dateThreshold.setMonth(dateThreshold.getMonth() - 3)
      console.log(`Режим фильтрации: импорт только данных за последние 3 месяца (с ${dateThreshold.toLocaleDateString()})`)
    } else {
      console.log('Режим: полный импорт всех данных')
    }

    const csvFilePath = join(process.cwd(), 'table_data', 'analytics.csv')
    console.log('Начинаем потоковый импорт analytics...')

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов`)

    const existingAnalyticsMap = new Map<string, { id: string }>()
    let skip = 0
    const batchSize = 2000 // Уменьшено с 10000 для экономии памяти
    
    while (true) {
      const whereClause: any = {}
      if (filterLast3Months && dateThreshold) {
        whereClause.date = { gte: dateThreshold }
      }

      const batch = await prisma.analytics.findMany({
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
        select: { id: true, branch: true, clientTIN: true, date: true },
        skip,
        take: batchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(analytics => {
        const key = analyticsKey(analytics.branch, analytics.clientTIN, analytics.date)
        existingAnalyticsMap.set(key, { id: analytics.id })
      })
      
      skip += batchSize
      if (batch.length < batchSize) break
      
      // Задержка для освобождения памяти между батчами
      await new Promise(resolve => setImmediate(resolve))
    }
    
    console.log(`Загружено ${existingAnalyticsMap.size} существующих записей analytics`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvAnalyticsKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 100 // Уменьшено с 500 для экономии памяти
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        await prisma.analytics.createMany({ data: createBatch, skipDuplicates: true })
        imported += createBatch.length
        createBatch.length = 0
      }

      for (const update of updateBatch) {
        try {
          await prisma.analytics.update({ where: { id: update.id }, data: update.data })
          updated++
        } catch (error) {
          errors++
        }
      }
      updateBatch.length = 0
    }

    const readStream = createReadStream(csvFilePath)
    let isFirstChunk = true
    const decodeStream = new Transform({
      transform(chunk: Buffer, encoding, callback) {
        try {
          if (isFirstChunk) {
            isFirstChunk = false
            if (chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
              chunk = chunk.slice(3)
            }
          }
          const decoded = chunk.toString('utf-8')
          this.push(decoded)
          callback()
        } catch (error) {
          callback(error as Error)
        }
      }
    })
    const parser = parse({
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })

    const processStream = new Transform({
      objectMode: true,
      async transform(record: AnalyticsCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
          const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
          const rawDate = record.Дата ? String(record.Дата) : ''
          const rawQuantityByRequest = record.КолвоПоЗаявке ? String(record.КолвоПоЗаявке) : '0'
          const rawQuantityByPlan = record.КолвоПоПлану ? String(record.КолвоПоПлану) : '0'
          const rawQuantityByFact = record.КолвоПоФакту ? String(record.КолвоПоФакту) : '0'
          const rawQuantityByDeparture = record.КолвоПоУбытию ? String(record.КолвоПоУбытию) : '0'

          if (!rawBranch || !rawClientTIN) {
            skippedRecords.push({ row: rowNumber, reason: 'Отсутствуют обязательные поля' })
            skipped++
            return callback()
          }

          const clientTIN = rawClientTIN.replace(/\D/g, '')
          if (!clientTIN || !clientTINsSet.has(clientTIN)) {
            skippedRecords.push({ row: rowNumber, reason: `Клиент с ИНН ${clientTIN} не найден` })
            skipped++
            return callback()
          }

          const date = parseDate(rawDate)
          if (!date) {
            skippedRecords.push({ row: rowNumber, reason: `Неверный формат даты: "${rawDate}"` })
            skipped++
            return callback()
          }

          // Фильтрация по датам: пропускаем записи старше 3 месяцев
          if (filterLast3Months && dateThreshold && date < dateThreshold) {
            skipped++
            return callback()
          }

          const quantityByRequest = parseInteger(rawQuantityByRequest)
          const quantityByPlan = parseInteger(rawQuantityByPlan)
          const quantityByFact = parseInteger(rawQuantityByFact)
          const quantityByDeparture = parseInteger(rawQuantityByDeparture)

          const key = analyticsKey(rawBranch, clientTIN, date)
          csvAnalyticsKeys.add(key)

          const existingAnalytics = existingAnalyticsMap.get(key)

          if (existingAnalytics) {
            updateBatch.push({
              id: existingAnalytics.id,
              data: {
                quantityByRequest,
                quantityByPlan,
                quantityByFact,
                quantityByDeparture,
              }
            })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            const existingInDb = await prisma.analytics.findFirst({
              where: { branch: rawBranch, clientTIN, date }
            })

            if (existingInDb) {
              updateBatch.push({
                id: existingInDb.id,
                data: {
                  quantityByRequest,
                  quantityByPlan,
                  quantityByFact,
                  quantityByDeparture,
                }
              })
              if (updateBatch.length >= BATCH_SIZE) await processBatches()
            } else {
              createBatch.push({
                branch: rawBranch,
                date,
                quantityByRequest,
                quantityByPlan,
                quantityByFact,
                quantityByDeparture,
                clientTIN,
              })
              if (createBatch.length >= BATCH_SIZE) await processBatches()
            }
          }

          if (rowNumber % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(`Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Скорость: ${rate.toFixed(0)} зап/сек`)
          }
        } catch (error) {
          errors++
          skippedRecords.push({ row: rowNumber, reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}` })
        }
        callback()
      },
    })

    await pipeline(readStream, decodeStream, parser, processStream)
    await processBatches()

    // Удаляем записи, отсутствующие в CSV
    // При фильтрации удаляем только записи из диапазона последних 3 месяцев
    if (filterLast3Months && dateThreshold) {
      console.log('\nРежим фильтрации: удаление только записей за последние 3 месяца, отсутствующих в CSV...')
    } else {
      console.log('\nУдаляем записи, отсутствующие в CSV...')
    }
    let deleted = 0
    const deleteBatch: string[] = []
    
    for (const [key, analytics] of existingAnalyticsMap.entries()) {
      if (!csvAnalyticsKeys.has(key)) {
        deleteBatch.push(analytics.id)
        if (deleteBatch.length >= BATCH_SIZE) {
          await prisma.analytics.deleteMany({ where: { id: { in: deleteBatch } } })
          deleted += deleteBatch.length
          deleteBatch.length = 0
        }
      }
    }
    
    if (deleteBatch.length > 0) {
      await prisma.analytics.deleteMany({ where: { id: { in: deleteBatch } } })
      deleted += deleteBatch.length
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('\n=== Результаты импорта ===')
    console.log(`Создано новых: ${imported}`)
    console.log(`Обновлено: ${updated}`)
    console.log(`Удалено: ${deleted}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    console.log(`Время выполнения: ${totalDuration} сек`)

    await prisma.importMetadata.upsert({
      where: { importType: 'analytics' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'analytics',
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
    })

    if (skippedRecords.length > 0) {
      console.log('\n=== Детализация пропущенных записей (первые 50) ===')
      skippedRecords.slice(0, 50).forEach(({ row, reason }) => {
        console.log(`Строка ${row}: ${reason}`)
      })
      if (skippedRecords.length > 50) {
        console.log(`\n... и еще ${skippedRecords.length - 50} пропущенных записей`)
      }
    }
  } catch (error) {
    console.error('Критическая ошибка:', error)
    throw error
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

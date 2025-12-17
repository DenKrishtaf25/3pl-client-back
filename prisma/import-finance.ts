import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

interface FinanceCsvRow {
  Филиал: string
  Клиент: string  // В CSV файле используется "Клиент" вместо "Контрагент"
  ИНН: string
  ДатаПоступления: string  // В CSV файле используется "ДатаПоступления" вместо "Дата"
  КодПретензии: string  // В CSV файле используется "КодПретензии" вместо "Номер заказа"
  СуммаПретензии: string  // В CSV файле используется "СуммаПретензии" вместо "Сумма"
  Статус: string
  Комменатарий?: string  // В CSV файле опечатка: "Комменатарий" вместо "Комментарий"
  ДатаЗавершения?: string  // Новая колонка
  ДатаЗакрытия?: string  // Новая колонка
}

// Функция для очистки значения
function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

// Функция для парсинга даты (поддерживает DD.MM.YYYY HH:mm, DD.MM.YYYY и YYYY-MM-DD)
function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  
  const cleaned = dateStr.trim()
  
  // Пробуем формат ISO: YYYY-MM-DD или YYYY-MM-DD HH:mm
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = isoMatch
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    )
    if (!isNaN(date.getTime())) {
      return date
    }
  }
  
  // Формат: DD.MM.YYYY HH:mm или DD.MM.YYYY
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (dateMatch) {
    const [, day, month, year, hour = '0', minute = '0'] = dateMatch
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    )
    if (!isNaN(date.getTime())) {
      return date
    }
  }
  
  // Пробуем встроенный парсер Date (может распознать другие форматы)
  const parsedDate = new Date(cleaned)
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate
  }
  
  return null
}

function parseDecimal(value: string): number {
  if (!value) return 0
  const cleaned = value.trim().replace(/,/g, '.').replace(/\s/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

const financeKey = (b: string, on: string, t: string, d: Date) => {
  const dateStr = d.toISOString().split('T')[0]
  return `${b}|${on}|${t}|${dateStr}`
}

function findColumn(columnNames: string[], variants: string[]): string | null {
  for (const variant of variants) {
    const found = columnNames.find(col => {
      const colTrimmed = col.trim()
      const variantTrimmed = variant.trim()
      if (colTrimmed === variantTrimmed) return true
      if (colTrimmed.toLowerCase() === variantTrimmed.toLowerCase()) return true
      const colNormalized = colTrimmed.replace(/[\s_]/g, '').toLowerCase()
      const variantNormalized = variantTrimmed.replace(/[\s_]/g, '').toLowerCase()
      if (colNormalized === variantNormalized) return true
      return false
    })
    if (found) return found
  }
  return null
}

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

    const csvFilePath = join(process.cwd(), 'table_data', 'finance.csv')
    console.log('Начинаем потоковый импорт finance...')

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов`)

    const existingFinancesMap = new Map<string, { id: string }>()
    let skip = 0
    const batchSize = 10000
    
    while (true) {
      const whereClause: any = {}
      if (filterLast3Months && dateThreshold) {
        whereClause.OR = [
          { date: { gte: dateThreshold } },
          { completionDate: { gte: dateThreshold } },
          { closingDate: { gte: dateThreshold } },
        ]
      }

      const batch = await prisma.finance.findMany({
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
        select: { id: true, branch: true, orderNumber: true, clientTIN: true, date: true },
        skip,
        take: batchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(finance => {
        const key = financeKey(finance.branch, finance.orderNumber, finance.clientTIN, finance.date)
        existingFinancesMap.set(key, { id: finance.id })
      })
      
      skip += batchSize
      if (batch.length < batchSize) break
    }
    
    console.log(`Загружено ${existingFinancesMap.size} существующих записей finance`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    let isFirstRecord = true
    let completionDateColumnName: string | null = null
    let closingDateColumnName: string | null = null
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvFinanceKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 500
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        await prisma.finance.createMany({ data: createBatch, skipDuplicates: true })
        imported += createBatch.length
        createBatch.length = 0
      }

      for (const update of updateBatch) {
        try {
          await prisma.finance.update({ where: { id: update.id }, data: update.data })
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
      async transform(record: FinanceCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          // Определяем колонки по первой записи
          if (isFirstRecord) {
            isFirstRecord = false
            const columnNames = Object.keys(record)
            console.log('\nНайденные колонки в CSV:', columnNames)
            
            const requiredColumns = ['Филиал', 'Клиент', 'ИНН', 'ДатаПоступления', 'КодПретензии', 'СуммаПретензии', 'Статус']
            const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
            
            if (missingColumns.length > 0) {
              throw new Error(`Отсутствуют необходимые колонки: ${missingColumns.join(', ')}`)
            }
            
            completionDateColumnName = findColumn(columnNames, [
              'ДатаЗавершения', 'Дата завершения', 'Дата Завершения',
              'дата_завершения', 'Дата_завершения', 'дата завершения'
            ])
            closingDateColumnName = findColumn(columnNames, [
              'ДатаЗакрытия', 'Дата закрытия', 'Дата Закрытия',
              'ПлановаяДатаЗакрытия', 'Плановая Дата Закрытия', 'Плановая дата закрытия',
              'дата_закрытия', 'Дата_закрытия'
            ])
            
            if (completionDateColumnName) {
              console.log(`Обнаружена колонка для даты завершения: "${completionDateColumnName}"`)
            }
            if (closingDateColumnName) {
              console.log(`Обнаружена колонка для даты закрытия: "${closingDateColumnName}"`)
            }
          }
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
          const rawCounterparty = record.Клиент ? cleanValue(String(record.Клиент)) : ''
          const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
          const rawDate = record.ДатаПоступления ? String(record.ДатаПоступления) : ''
          const rawOrderNumber = record.КодПретензии ? cleanValue(String(record.КодПретензии)) : ''
          const rawAmount = record.СуммаПретензии ? String(record.СуммаПретензии) : '0'
          const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
          const rawComment = record.Комменатарий ? cleanValue(String(record.Комменатарий)) : null
          
          let rawCompletionDate: string | null = null
          let rawClosingDate: string | null = null
          
          if (completionDateColumnName) {
            const value = String(record[completionDateColumnName as keyof FinanceCsvRow] || '').trim()
            if (value && value !== '' && value.toLowerCase() !== 'null' && value !== '-' && value !== 'NULL') {
              rawCompletionDate = value
            }
          }
          
          if (closingDateColumnName) {
            const value = String(record[closingDateColumnName as keyof FinanceCsvRow] || '').trim()
            if (value && value !== '' && value.toLowerCase() !== 'null' && value !== '-' && value !== 'NULL') {
              rawClosingDate = value
            }
          }

          if (!rawBranch || !rawClientTIN || !rawOrderNumber || !rawStatus) {
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

          const amount = parseDecimal(rawAmount)
          let completionDate: Date | null = null
          let closingDate: Date | null = null
          
          if (rawCompletionDate) {
            completionDate = parseDate(rawCompletionDate)
          }
          if (rawClosingDate) {
            closingDate = parseDate(rawClosingDate)
          }

          // Фильтрация по датам: пропускаем записи старше 3 месяцев
          if (filterLast3Months && dateThreshold) {
            const hasRecentDate = 
              (date && date >= dateThreshold) ||
              (completionDate && completionDate >= dateThreshold) ||
              (closingDate && closingDate >= dateThreshold)
            
            if (!hasRecentDate) {
              skipped++
              return callback()
            }
          }

          const key = financeKey(rawBranch, rawOrderNumber, clientTIN, date)
          csvFinanceKeys.add(key)

          const existingFinance = existingFinancesMap.get(key)

          if (existingFinance) {
            updateBatch.push({
              id: existingFinance.id,
              data: {
                branch: rawBranch,
                counterparty: rawCounterparty || 'Не указан',
                date,
                orderNumber: rawOrderNumber,
                amount,
                status: rawStatus,
                comment: rawComment,
                completionDate,
                closingDate,
              }
            })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            const existingInDb = await prisma.finance.findFirst({
              where: { branch: rawBranch, orderNumber: rawOrderNumber, clientTIN, date }
            })

            if (existingInDb) {
              updateBatch.push({
                id: existingInDb.id,
                data: {
                  branch: rawBranch,
                  counterparty: rawCounterparty || 'Не указан',
                  date,
                  orderNumber: rawOrderNumber,
                  amount,
                  status: rawStatus,
                  comment: rawComment,
                  completionDate,
                  closingDate,
                }
              })
              if (updateBatch.length >= BATCH_SIZE) await processBatches()
            } else {
              createBatch.push({
                branch: rawBranch,
                counterparty: rawCounterparty || 'Не указан',
                date,
                orderNumber: rawOrderNumber,
                amount,
                status: rawStatus,
                comment: rawComment,
                completionDate,
                closingDate,
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
    
    for (const [key, finance] of existingFinancesMap.entries()) {
      if (!csvFinanceKeys.has(key)) {
        deleteBatch.push(finance.id)
        if (deleteBatch.length >= BATCH_SIZE) {
          await prisma.finance.deleteMany({ where: { id: { in: deleteBatch } } })
          deleted += deleteBatch.length
          deleteBatch.length = 0
        }
      }
    }
    
    if (deleteBatch.length > 0) {
      await prisma.finance.deleteMany({ where: { id: { in: deleteBatch } } })
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
      where: { importType: 'finance' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'finance',
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


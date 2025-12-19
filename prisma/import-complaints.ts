import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

interface ComplaintCsvRow {
  Филиал: string
  Клиент: string
  ИНН: string
  ДатаСоздания: string
  НомерРекламации: string
  ТипПретензии: string
  Статус: string
  Подтверждение: string
  'Крайний срок'?: string  // Новая колонка
  'Дата завершения'?: string  // Новая колонка
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

function parseBoolean(value: string): boolean {
  if (!value) return false
  const cleaned = value.trim()
  return cleaned === '1' || cleaned.toLowerCase() === 'true'
}

const complaintKey = (b: string, cn: string, t: string, d: Date) => {
  const dateStr = d.toISOString().split('T')[0]
  return `${b}|${cn}|${t}|${dateStr}`
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

    const csvFilePath = join(process.cwd(), 'table_data', 'complaints.csv')
    console.log('Начинаем потоковый импорт complaints...')

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов`)

    const existingComplaintsMap = new Map<string, { id: string }>()
    let skip = 0
    const batchSize = 2000 // Уменьшено с 10000 для экономии памяти
    
    // ВСЕГДА фильтруем по последним 3 месяцам для экономии памяти
    const loadDateThreshold = filterLast3Months && dateThreshold 
      ? dateThreshold 
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Последние 90 дней по умолчанию
    
    console.log(`Загружаем существующие записи complaints (только последние 3 месяца с ${loadDateThreshold.toLocaleDateString()})...`)
    while (true) {
      const whereClause: any = {
        OR: [
          { creationDate: { gte: loadDateThreshold } },
          { deadline: { gte: loadDateThreshold } },
          { completionDate: { gte: loadDateThreshold } },
        ]
      }

      const batch = await prisma.complaint.findMany({
        where: whereClause,
        select: { id: true, branch: true, complaintNumber: true, clientTIN: true, creationDate: true },
        skip,
        take: batchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(complaint => {
        const key = complaintKey(complaint.branch, complaint.complaintNumber, complaint.clientTIN, complaint.creationDate)
        existingComplaintsMap.set(key, { id: complaint.id })
      })
      
      skip += batchSize
      if (batch.length < batchSize) break
      
      // Задержка для освобождения памяти между батчами
      await new Promise(resolve => setImmediate(resolve))
    }
    
    console.log(`Загружено ${existingComplaintsMap.size} существующих записей complaints (только последние 3 месяца)`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    let isFirstRecord = true
    let deadlineColumnName: string | null = null
    let completionDateColumnName: string | null = null
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvComplaintKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 100 // Уменьшено с 500 для экономии памяти
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        await prisma.complaint.createMany({ data: createBatch, skipDuplicates: true })
        imported += createBatch.length
        createBatch.length = 0
      }

      for (const update of updateBatch) {
        try {
          await prisma.complaint.update({ where: { id: update.id }, data: update.data })
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
      async transform(record: ComplaintCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          // Определяем колонки по первой записи
          if (isFirstRecord) {
            isFirstRecord = false
            const columnNames = Object.keys(record)
            console.log('\nНайденные колонки в CSV:', columnNames)
            
            const requiredColumns = ['Филиал', 'Клиент', 'ИНН', 'ДатаСоздания', 'НомерРекламации', 'ТипПретензии', 'Статус', 'Подтверждение']
            const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
            
            if (missingColumns.length > 0) {
              throw new Error(`Отсутствуют необходимые колонки: ${missingColumns.join(', ')}`)
            }
            
            deadlineColumnName = findColumn(columnNames, ['Крайний срок', 'КрайнийСрок', 'крайний срок'])
            completionDateColumnName = findColumn(columnNames, ['Дата завершения', 'ДатаЗавершения', 'дата завершения', 'дата_завершения'])
            
            if (deadlineColumnName) {
              console.log(`Обнаружена колонка для крайнего срока: "${deadlineColumnName}"`)
            }
            if (completionDateColumnName) {
              console.log(`Обнаружена колонка для даты завершения: "${completionDateColumnName}"`)
            }
          }
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
          const rawClient = record.Клиент ? cleanValue(String(record.Клиент)) : ''
          const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
          const rawCreationDate = record.ДатаСоздания ? String(record.ДатаСоздания) : ''
          const rawComplaintNumber = record.НомерРекламации ? cleanValue(String(record.НомерРекламации)) : ''
          const rawComplaintType = record.ТипПретензии ? cleanValue(String(record.ТипПретензии)) : ''
          const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
          const rawConfirmation = record.Подтверждение ? String(record.Подтверждение) : '0'
          
          let rawDeadline: string | null = null
          let rawCompletionDate: string | null = null
          
          if (deadlineColumnName && record[deadlineColumnName as keyof ComplaintCsvRow]) {
            const value = String(record[deadlineColumnName as keyof ComplaintCsvRow] || '').trim()
            if (value && value !== '' && value.toLowerCase() !== 'null' && value !== '-' && value !== 'NULL') {
              rawDeadline = value
            }
          }
          
          if (completionDateColumnName && record[completionDateColumnName as keyof ComplaintCsvRow]) {
            const value = String(record[completionDateColumnName as keyof ComplaintCsvRow] || '').trim()
            if (value && value !== '' && value.toLowerCase() !== 'null' && value !== '-' && value !== 'NULL') {
              rawCompletionDate = value
            }
          }

          if (!rawBranch || !rawClientTIN || !rawComplaintNumber || !rawStatus) {
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

          const creationDate = parseDate(rawCreationDate)
          if (!creationDate) {
            skippedRecords.push({ row: rowNumber, reason: `Неверный формат даты: "${rawCreationDate}"` })
            skipped++
            return callback()
          }

          const confirmation = parseBoolean(rawConfirmation)
          let deadline: Date | null = null
          let completionDate: Date | null = null
          
          if (rawDeadline) {
            deadline = parseDate(rawDeadline)
          }
          if (rawCompletionDate) {
            completionDate = parseDate(rawCompletionDate)
          }

          // Фильтрация по датам: пропускаем записи старше 3 месяцев
          if (filterLast3Months && dateThreshold) {
            const hasRecentDate = 
              (creationDate && creationDate >= dateThreshold) ||
              (deadline && deadline >= dateThreshold) ||
              (completionDate && completionDate >= dateThreshold)
            
            if (!hasRecentDate) {
              skipped++
              return callback()
            }
          }

          const key = complaintKey(rawBranch, rawComplaintNumber, clientTIN, creationDate)
          csvComplaintKeys.add(key)

          const existingComplaint = existingComplaintsMap.get(key)

          if (existingComplaint) {
            updateBatch.push({
              id: existingComplaint.id,
              data: {
                branch: rawBranch,
                client: rawClient || 'Не указан',
                creationDate,
                complaintNumber: rawComplaintNumber,
                complaintType: rawComplaintType || 'Не указан',
                status: rawStatus,
                confirmation,
                deadline,
                completionDate,
              }
            })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            const existingInDb = await prisma.complaint.findFirst({
              where: { branch: rawBranch, complaintNumber: rawComplaintNumber, clientTIN, creationDate }
            })

            if (existingInDb) {
              updateBatch.push({
                id: existingInDb.id,
                data: {
                  branch: rawBranch,
                  client: rawClient || 'Не указан',
                  creationDate,
                  complaintNumber: rawComplaintNumber,
                  complaintType: rawComplaintType || 'Не указан',
                  status: rawStatus,
                  confirmation,
                  deadline,
                  completionDate,
                }
              })
              if (updateBatch.length >= BATCH_SIZE) await processBatches()
            } else {
              createBatch.push({
                branch: rawBranch,
                client: rawClient || 'Не указан',
                creationDate,
                complaintNumber: rawComplaintNumber,
                complaintType: rawComplaintType || 'Не указан',
                status: rawStatus,
                confirmation,
                deadline,
                completionDate,
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
    
    for (const [key, complaint] of existingComplaintsMap.entries()) {
      if (!csvComplaintKeys.has(key)) {
        deleteBatch.push(complaint.id)
        if (deleteBatch.length >= BATCH_SIZE) {
          await prisma.complaint.deleteMany({ where: { id: { in: deleteBatch } } })
          deleted += deleteBatch.length
          deleteBatch.length = 0
        }
      }
    }
    
    if (deleteBatch.length > 0) {
      await prisma.complaint.deleteMany({ where: { id: { in: deleteBatch } } })
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
      where: { importType: 'complaints' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'complaints',
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


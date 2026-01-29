import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

interface OrderCsvRow {
  Филиал: string
  'Тип заказа': string
  'Номер заказа': string
  'Номер заказа КИС': string
  'Дата выгрузки заказа': string
  'Плановая дата отгрузки': string
  Статус: string
  КоличествоУпаковокПлан: string
  КоличествоУпаковокФакт: string
  КоличествоСтрокПлан: string
  КоличествоСтрокФакт: string
  Контрагент: string
  'Дата приемки/отгрузки': string
  ИНН: string
  Клиент: string
}

function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  const cleaned = dateStr.trim()
  
  // Формат: YYYY-MM-DD HH:mm:ss или YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = isoMatch
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`)
    return !isNaN(date.getTime()) ? date : null
  }
  
  // Формат: DD.MM.YYYY HH:mm или DD.MM.YYYY
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (dateMatch) {
    const [, day, month, year, hour = '0', minute = '0'] = dateMatch
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`)
    return !isNaN(date.getTime()) ? date : null
  }
  
  return null
}

function parseInteger(value: string): number {
  if (!value) return 0
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '').replace(/\./g, '')
  // Пробуем парсить как число
  let num = parseInt(cleaned, 10)
  if (isNaN(num)) {
    // Если не получилось, пробуем parseFloat и округляем
    const floatNum = parseFloat(cleaned)
    num = isNaN(floatNum) ? 0 : Math.round(floatNum)
  }
  // Ограничиваем значение максимальным для Int (32-bit signed integer)
  const MAX_INT = 2147483647
  const MIN_INT = -2147483648
  if (num > MAX_INT) {
    console.warn(`Значение ${num} (из "${value}") превышает MAX_INT, обрезано до ${MAX_INT}`)
    return MAX_INT
  }
  if (num < MIN_INT) {
    console.warn(`Значение ${num} (из "${value}") меньше MIN_INT, обрезано до ${MIN_INT}`)
    return MIN_INT
  }
  return num
}

const orderKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`

async function processCsvFile(csvFilePath: string, fileName: string, clearBeforeImport: boolean = false) {
  console.log(`\n=== Обработка файла: ${fileName} ===`)
  
  let imported = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  let rowNumber = 1
  const csvSeenKeys = new Set<string>() // Для отслеживания дубликатов в CSV
  const startTime = Date.now()

  const BATCH_SIZE = 2000 // Увеличенный размер батча для максимальной скорости
  const createBatch: Array<any> = []
  const updateBatch: Array<{ id: string; data: any }> = []

  // Загружаем список клиентов для проверки foreign key constraint
  console.log('Загружаем список клиентов для проверки...')
  const allClients = await prisma.client.findMany({ select: { TIN: true } })
  const clientTINsSet = new Set(allClients.map(c => c.TIN))
  console.log(`Загружено ${clientTINsSet.size} клиентов для проверки`)

  // Загружаем все существующие записи в память для быстрого поиска (только если не делаем полную очистку)
  const existingOrdersMap = new Map<string, { id: string }>()
  
  if (!clearBeforeImport) {
    console.log('Загружаем все существующие записи orders в память...')
    let skip = 0
    const loadBatchSize = 5000
    
    while (true) {
      const batch = await prisma.order.findMany({
        select: { id: true, branch: true, orderType: true, orderNumber: true, clientTIN: true },
        skip,
        take: loadBatchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(order => {
        const normalizedBranch = order.branch.trim()
        const normalizedOrderType = order.orderType.trim()
        const normalizedOrderNumber = order.orderNumber.trim()
        const normalizedClientTIN = order.clientTIN.trim()
        const key = orderKey(normalizedBranch, normalizedOrderType, normalizedOrderNumber, normalizedClientTIN)
        existingOrdersMap.set(key, { id: order.id })
      })
      
      skip += loadBatchSize
      if (batch.length < loadBatchSize) break
      
      await new Promise(resolve => setImmediate(resolve))
    }
    
    console.log(`Загружено ${existingOrdersMap.size} существующих записей orders в память`)
  } else {
    console.log('Таблица очищена, импортируем только новые записи (без проверки существующих)')
  }

  async function processBatches() {
    if (createBatch.length > 0) {
      // Убрали skipDuplicates для максимальной скорости - полагаемся на уникальные индексы БД
      const batchStartTime = Date.now()
      const batchSize = createBatch.length
      try {
        await prisma.order.createMany({ data: createBatch })
        imported += createBatch.length
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2)
        if (batchSize >= 500) {
          console.log(`[processBatches] Создано ${batchSize} записей за ${batchDuration} сек`)
        }
      } catch (error: any) {
        // Обрабатываем различные типы ошибок
        if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
          // Дубликаты - пропускаем батч, так как записи уже существуют
          skipped += batchSize
          const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2)
          if (batchSize >= 500) {
            console.log(`[processBatches] Пропущено ${batchSize} дубликатов за ${batchDuration} сек`)
          }
        } else if (error.code === 'P2003' || error.message?.includes('Foreign key constraint')) {
          // Foreign key constraint - клиент не найден (хотя мы проверяли, но могли быть изменения)
          // Пробуем вставить по одной записи, пропуская проблемные
          const batchCopy = [...createBatch] // Сохраняем копию перед очисткой
          let successCount = 0
          let failCount = 0
          for (const record of batchCopy) {
            try {
              await prisma.order.create({ data: record })
              successCount++
              imported++
            } catch (innerError: any) {
              if (innerError.code === 'P2003' || innerError.message?.includes('Foreign key constraint')) {
                skipped++
                failCount++
              } else {
                errors++
                failCount++
              }
            }
          }
          if (batchSize >= 500 && failCount > 0) {
            const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2)
            console.log(`[processBatches] Создано ${successCount}/${batchSize} записей, пропущено ${failCount} (foreign key) за ${batchDuration} сек`)
          }
        } else {
          // Другая ошибка - логируем
          console.error(`Ошибка при создании батча из ${batchSize} записей: ${error.message}`)
          errors += batchSize
        }
      }
      createBatch.length = 0
    }

    if (updateBatch.length > 0) {
      // Быстрое обновление батчами по 100
      const updateConcurrency = 100
      for (let i = 0; i < updateBatch.length; i += updateConcurrency) {
        const batch = updateBatch.slice(i, i + updateConcurrency)
        await Promise.all(
          batch.map(async (update) => {
            try {
              await prisma.order.update({ where: { id: update.id }, data: update.data })
              updated++
            } catch (error) {
              errors++
            }
          })
        )
      }
      updateBatch.length = 0
    }
  }

  const readStream = createReadStream(csvFilePath)
  console.log('Используем кодировку UTF-8 для декодирования')

  // Создаем Transform stream для декодирования UTF-8
  let isFirstChunk = true
  const decodeStream = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      try {
        // Удаляем BOM из первого чанка если он есть
        if (isFirstChunk) {
          isFirstChunk = false
          if (chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
            chunk = chunk.slice(3)
            console.log('Обнаружен UTF-8 BOM, удаляем...')
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

  // Парсер CSV
  const parser = parse({
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true, // Автоматически удаляет BOM
  })

  // Трансформ для обработки записей
  const processStream = new Transform({
    objectMode: true,
    async transform(record: OrderCsvRow, encoding, callback) {
      rowNumber++
      
      try {
        const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)).trim() : ''
        const rawOrderType = record['Тип заказа'] ? cleanValue(String(record['Тип заказа'])).trim() : ''
        const rawOrderNumber = record['Номер заказа'] ? cleanValue(String(record['Номер заказа'])).trim() : ''
        const rawKisNumber = record['Номер заказа КИС'] ? cleanValue(String(record['Номер заказа КИС'])).trim() : ''
        const rawExportDate = record['Дата выгрузки заказа'] ? String(record['Дата выгрузки заказа']) : ''
        const rawShipmentDate = record['Плановая дата отгрузки'] ? String(record['Плановая дата отгрузки']) : ''
        const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
        const rawPackagesPlanned = record.КоличествоУпаковокПлан ? String(record.КоличествоУпаковокПлан) : '0'
        const rawPackagesActual = record.КоличествоУпаковокФакт ? String(record.КоличествоУпаковокФакт) : '0'
        const rawLinesPlanned = record.КоличествоСтрокПлан ? String(record.КоличествоСтрокПлан) : '0'
        const rawLinesActual = record.КоличествоСтрокФакт ? String(record.КоличествоСтрокФакт) : '0'
        const rawCounterparty = record.Контрагент ? cleanValue(String(record.Контрагент)) : ''
        const rawAcceptanceDate = record['Дата приемки/отгрузки'] ? String(record['Дата приемки/отгрузки']) : ''
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''

        // Минимальная валидация - только обязательные поля
        if (!rawBranch || !rawClientTIN || !rawOrderType || !rawOrderNumber || !rawStatus) {
          skipped++
          return callback()
        }

        const clientTIN = rawClientTIN.replace(/\D/g, '')
        if (!clientTIN) {
          skipped++
          return callback()
        }

        // Проверяем существование клиента перед созданием записи
        if (!clientTINsSet.has(clientTIN)) {
          skipped++
          return callback()
        }

        const exportDate = parseDate(rawExportDate) || new Date()
        const shipmentDate = parseDate(rawShipmentDate)
        const acceptanceDate = parseDate(rawAcceptanceDate)
        
        const packagesPlanned = parseInteger(rawPackagesPlanned)
        const packagesActual = parseInteger(rawPackagesActual)
        const linesPlanned = parseInteger(rawLinesPlanned)
        const linesActual = parseInteger(rawLinesActual)

        const key = orderKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
        
        // Проверяем дубликаты в CSV файле
        if (csvSeenKeys.has(key)) {
          skipped++
          return callback()
        }
        csvSeenKeys.add(key)

        const existingOrder = existingOrdersMap.get(key)

        if (existingOrder) {
          updateBatch.push({
            id: existingOrder.id,
            data: {
              branch: rawBranch,
              orderType: rawOrderType,
              orderNumber: rawOrderNumber,
              kisNumber: rawKisNumber || '',
              exportDate,
              shipmentDate,
              status: rawStatus,
              packagesPlanned,
              packagesActual,
              linesPlanned,
              linesActual,
              counterparty: rawCounterparty || 'Не указан',
              acceptanceDate,
            }
          })
          // Обрабатываем обновления батчами по 1000
          if (updateBatch.length >= 1000) {
            await processBatches()
          }
        } else {
          createBatch.push({
            branch: rawBranch,
            orderType: rawOrderType,
            orderNumber: rawOrderNumber,
            kisNumber: rawKisNumber || '',
            exportDate,
            shipmentDate,
            status: rawStatus,
            packagesPlanned,
            packagesActual,
            linesPlanned,
            linesActual,
            counterparty: rawCounterparty || 'Не указан',
            acceptanceDate,
            clientTIN,
          })
          // Добавляем в память с временным ID
          existingOrdersMap.set(key, { id: '' })
          if (createBatch.length >= BATCH_SIZE) await processBatches()
        }

        if (rowNumber % 10000 === 0) {
          const elapsedSeconds = (Date.now() - startTime) / 1000
          const elapsed = elapsedSeconds.toFixed(1)
          const rate = (rowNumber / elapsedSeconds) * 1000
          const minutesElapsed = (elapsedSeconds / 60).toFixed(1)
          console.log(`[${fileName}] Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Пропущено: ${skipped} | Скорость: ${rate.toFixed(0)} зап/сек | Время: ${minutesElapsed} мин`)
        }
      } catch (error) {
        errors++
      }
      callback()
    },
  })

  console.log(`Начинаем обработку CSV потока для ${fileName}...`)
  await pipeline(readStream, decodeStream, parser, processStream)
  console.log(`CSV поток завершен для ${fileName}. Всего обработано строк: ${rowNumber}`)
  console.log(`Обрабатываем финальные батчи: createBatch=${createBatch.length}, updateBatch=${updateBatch.length}`)
  await processBatches()
  console.log('Финальные батчи обработаны')

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n=== Результаты импорта ${fileName} ===`)
  console.log(`Создано новых: ${imported}`)
  console.log(`Обновлено: ${updated}`)
  console.log(`Пропущено: ${skipped}`)
  console.log(`Ошибок: ${errors}`)
  console.log(`Время выполнения: ${totalDuration} сек`)

  return { imported, updated, skipped, errors }
}

async function main() {
  try {
    console.log('=== Ручной импорт orders: быстрый режим без проверок ===')
    console.log('Импортируем оба файла: orders_online.csv и orders_save.csv')
    
    // Проверяем, нужно ли очистить таблицу перед импортом
    const clearBeforeImport = process.env.CLEAR_BEFORE_IMPORT === 'true'
    
    if (clearBeforeImport) {
      console.log('\n⚠️  ВНИМАНИЕ: Режим полной очистки таблицы перед импортом!')
      console.log('Удаляем все существующие записи из таблицы orders...')
      const deletedCount = await prisma.order.deleteMany({})
      console.log(`Удалено ${deletedCount.count} записей из таблицы orders`)
      console.log('Начинаем импорт в пустую таблицу...\n')
    } else {
      console.log('Режим: обновление существующих записей и добавление новых (upsert)')
      console.log('Для полной очистки таблицы перед импортом используйте: CLEAR_BEFORE_IMPORT=true npm run import:orders\n')
    }
    
    const ordersDir = join(process.cwd(), 'table_data', 'orders')
    const ordersOnlinePath = join(ordersDir, 'orders_online.csv')
    const ordersSavePath = join(ordersDir, 'orders_save.csv')

    const startTime = Date.now()
    
    // Импортируем оба файла последовательно
    // Для второго файла clearBeforeImport всегда false, так как очистка уже выполнена
    const result1 = await processCsvFile(ordersOnlinePath, 'orders_online.csv', clearBeforeImport)
    const result2 = await processCsvFile(ordersSavePath, 'orders_save.csv', false)

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('\n=== Итоговые результаты импорта ===')
    console.log(`Создано новых: ${result1.imported + result2.imported}`)
    console.log(`Обновлено: ${result1.updated + result2.updated}`)
    console.log(`Пропущено: ${result1.skipped + result2.skipped}`)
    console.log(`Ошибок: ${result1.errors + result2.errors}`)
    console.log(`Общее время выполнения: ${totalDuration} сек`)

    await prisma.importMetadata.upsert({
      where: { importType: 'orders' },
      update: {
        lastImportAt: new Date(),
        recordsImported: result1.imported + result2.imported,
        recordsUpdated: result1.updated + result2.updated,
        recordsDeleted: 0,
        recordsSkipped: result1.skipped + result2.skipped,
        errors: result1.errors + result2.errors,
      },
      create: {
        importType: 'orders',
        lastImportAt: new Date(),
        recordsImported: result1.imported + result2.imported,
        recordsUpdated: result1.updated + result2.updated,
        recordsDeleted: 0,
        recordsSkipped: result1.skipped + result2.skipped,
        errors: result1.errors + result2.errors,
      },
    })
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

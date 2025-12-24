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
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : num
}

const orderKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`

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

    const csvFilePath = join(process.cwd(), 'table_data', 'orders.csv')
    console.log('Начинаем потоковый импорт orders...')

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов`)

    const existingOrdersMap = new Map<string, { id: string }>()
    let skip = 0
    const batchSize = 2000
    
    // Загружаем существующие записи: при фильтрации - только последние 3 месяца, иначе - все
    const whereClause: any = filterLast3Months && dateThreshold
      ? {
          OR: [
            { exportDate: { gte: dateThreshold } },
            { shipmentDate: { gte: dateThreshold } },
            { acceptanceDate: { gte: dateThreshold } },
          ]
        }
      : {} // Полный импорт - загружаем все записи
    
    if (filterLast3Months && dateThreshold) {
      console.log(`Загружаем существующие записи orders (только последние 3 месяца с ${dateThreshold.toLocaleDateString()})...`)
    } else {
      console.log(`Загружаем все существующие записи orders (полный импорт)...`)
    }
    
    while (true) {

      const batch = await prisma.order.findMany({
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
        select: { id: true, branch: true, orderType: true, orderNumber: true, clientTIN: true },
        skip,
        take: batchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(order => {
        const key = orderKey(order.branch, order.orderType, order.orderNumber, order.clientTIN)
        existingOrdersMap.set(key, { id: order.id })
      })
      
      skip += batchSize
      
      if (batch.length < batchSize) break
      
      // Задержка для освобождения памяти между батчами
      await new Promise(resolve => setImmediate(resolve))
    }
    
    if (filterLast3Months && dateThreshold) {
      console.log(`Загружено ${existingOrdersMap.size} существующих записей orders (только последние 3 месяца)`)
    } else {
      console.log(`Загружено ${existingOrdersMap.size} существующих записей orders (полный импорт)`)
    }

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvOrderKeys = new Set<string>()
    const csvSeenKeys = new Set<string>() // Для отслеживания дубликатов в CSV
    const startTime = Date.now()

    const BATCH_SIZE = 100
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        const batchSize = createBatch.length
        const startTime = Date.now()
        await prisma.order.createMany({ data: createBatch, skipDuplicates: true })
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        imported += batchSize
        createBatch.length = 0
        if (batchSize >= 100) {
          console.log(`[processBatches] Создано ${batchSize} записей за ${duration} сек`)
        }
      }

      if (updateBatch.length > 0) {
        console.log(`[processBatches] Обновляем ${updateBatch.length} записей...`)
        const startTime = Date.now()
        const updateConcurrency = 50 // Обновляем по 50 параллельно
        let updateCount = 0
        
        for (let i = 0; i < updateBatch.length; i += updateConcurrency) {
          const batch = updateBatch.slice(i, i + updateConcurrency)
          await Promise.all(
            batch.map(async (update) => {
              try {
                await prisma.order.update({ where: { id: update.id }, data: update.data })
                updated++
                updateCount++
              } catch (error) {
                errors++
              }
            })
          )
          
          if (updateCount % 200 === 0 || updateCount === updateBatch.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            console.log(`[processBatches] Обновлено ${updateCount}/${updateBatch.length} за ${elapsed} сек...`)
          }
        }
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[processBatches] Обновлено ${updateCount} записей за ${duration} сек`)
      }
      updateBatch.length = 0
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

    // Парсер CSV - важно: columns должен быть true для использования первой строки как заголовков
    const parser = parse({
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true, // Автоматически удаляет BOM
    })

    // Трансформ для обработки записей
    let isFirstDataRecord = true
    const processStream = new Transform({
      objectMode: true,
      async transform(record: OrderCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          // Отладка первой записи данных
          if (isFirstDataRecord) {
            isFirstDataRecord = false
            console.log('Первая запись данных:', JSON.stringify(record, null, 2))
            console.log('Ключи записи:', Object.keys(record))
          }
          
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
          const rawOrderType = record['Тип заказа'] ? cleanValue(String(record['Тип заказа'])) : ''
          const rawOrderNumber = record['Номер заказа'] ? cleanValue(String(record['Номер заказа'])) : ''
          const rawKisNumber = record['Номер заказа КИС'] ? cleanValue(String(record['Номер заказа КИС'])) : ''
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

          if (!rawBranch || !rawClientTIN || !rawOrderType || !rawOrderNumber || !rawStatus) {
            if (rowNumber <= 5) {
              console.log(`Строка ${rowNumber}: Пропущена. Значения: Филиал="${rawBranch}", ИНН="${rawClientTIN}", Тип="${rawOrderType}", Номер="${rawOrderNumber}", Статус="${rawStatus}"`)
              console.log(`Строка ${rowNumber}: Ключи record:`, Object.keys(record))
            }
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

          const exportDate = parseDate(rawExportDate) || new Date()
          const shipmentDate = parseDate(rawShipmentDate)
          const acceptanceDate = parseDate(rawAcceptanceDate)
          
          // Фильтрация по датам: пропускаем записи старше 3 месяцев
          if (filterLast3Months && dateThreshold) {
            const hasRecentDate = 
              (exportDate && exportDate >= dateThreshold) ||
              (shipmentDate && shipmentDate >= dateThreshold) ||
              (acceptanceDate && acceptanceDate >= dateThreshold)
            
            if (!hasRecentDate) {
              skipped++
              return callback()
            }
          }
          
          const packagesPlanned = parseInteger(rawPackagesPlanned)
          const packagesActual = parseInteger(rawPackagesActual)
          const linesPlanned = parseInteger(rawLinesPlanned)
          const linesActual = parseInteger(rawLinesActual)

          const key = orderKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
          
          // Проверяем дубликаты в CSV файле
          if (csvSeenKeys.has(key)) {
            // Это дубликат в CSV - пропускаем
            skipped++
            if (rowNumber <= 10) {
              console.log(`Строка ${rowNumber}: Пропущена - дубликат в CSV (уже обработана ранее)`)
            }
            return callback()
          }
          csvSeenKeys.add(key)
          csvOrderKeys.add(key)

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
            if (createBatch.length >= BATCH_SIZE) await processBatches()
          }

          if (rowNumber % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(`Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Пропущено: ${skipped} | Скорость: ${rate.toFixed(0)} зап/сек`)
            console.log(`  В createBatch: ${createBatch.length}, В updateBatch: ${updateBatch.length}`)
          }
        } catch (error) {
          errors++
          skippedRecords.push({ row: rowNumber, reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}` })
        }
        callback()
      },
    })

    console.log('Начинаем обработку CSV потока...')
    await pipeline(readStream, decodeStream, parser, processStream)
    console.log(`CSV поток завершен. Всего обработано строк: ${rowNumber}`)
    console.log(`Обрабатываем финальные батчи: createBatch=${createBatch.length}, updateBatch=${updateBatch.length}`)
    await processBatches()
    console.log('Финальные батчи обработаны')

    // Удаляем записи, отсутствующие в CSV
    // При фильтрации удаляем только записи из диапазона последних 3 месяцев
    if (filterLast3Months && dateThreshold) {
      console.log('\nРежим фильтрации: удаление только записей за последние 3 месяца, отсутствующих в CSV...')
    } else {
      console.log('\nУдаляем записи, отсутствующие в CSV...')
    }
    let deleted = 0
    const deleteBatch: string[] = []
    
    for (const [key, order] of existingOrdersMap.entries()) {
      if (!csvOrderKeys.has(key)) {
        deleteBatch.push(order.id)
        if (deleteBatch.length >= BATCH_SIZE) {
          await prisma.order.deleteMany({ where: { id: { in: deleteBatch } } })
          deleted += deleteBatch.length
          deleteBatch.length = 0
        }
      }
    }
    
    if (deleteBatch.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: deleteBatch } } })
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
      where: { importType: 'orders' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'orders',
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

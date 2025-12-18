import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

interface StockCsvRow {
  Склад: string
  Поклажедатель: string
  ИНН: string
  Ячейка: string
  Наименование: string
  Артикул: string
  Код: string
  Колво: string
  Контейнер: string
  'Дата приемки или отгрузки': string
  'Время нахождения в ячейке (в часах)': string
  Зона: string
  ТипЗоны: string
}

// Функция для очистки значения
function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

// Функция для парсинга количества (целое число)
function parseQuantity(value: string): number {
  if (!value) return 0
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : num
}

// Функция для создания уникального ключа записи
const stockKey = (w: string, n: string, a: string, t: string) => `${w}|${n}|${a}|${t}`

// Функция для парсинга даты из CSV stock (поддерживает DD.MM.YYYY и YYYY-MM-DD)
function parseStockDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  
  const cleaned = dateStr.trim()
  
  // Формат ISO: YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    if (!isNaN(date.getTime())) return date
  }
  
  // Формат: DD.MM.YYYY
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (dateMatch) {
    const [, day, month, year] = dateMatch
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    if (!isNaN(date.getTime())) return date
  }
  
  const parsedDate = new Date(cleaned)
  return !isNaN(parsedDate.getTime()) ? parsedDate : null
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

    const csvFilePath = join(process.cwd(), 'table_data', 'stock.csv')
    console.log('Начинаем потоковый импорт stock...')

    // Загружаем список клиентов для проверки (это небольшой набор данных)
    console.log('Загружаем список клиентов для проверки...')
    const allClients = await prisma.client.findMany({
      select: { TIN: true }
    })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов для проверки`)

    // Загружаем существующие записи stock порциями для создания Map
    // Используем только ключевые поля для экономии памяти
    console.log('Загружаем существующие записи stock для сравнения...')
    const existingStocksMap = new Map<string, { id: string; quantity: number }>()
    
    let skip = 0
    const batchSize = 2000 // Уменьшено с 10000 для экономии памяти
    while (true) {
      const batch = await prisma.stock.findMany({
        select: {
          id: true,
          warehouse: true,
          nomenclature: true,
          article: true,
          quantity: true,
          clientTIN: true,
        },
        skip,
        take: batchSize,
      })
      
      if (batch.length === 0) break
      
      batch.forEach(stock => {
        const key = stockKey(stock.warehouse, stock.nomenclature, stock.article, stock.clientTIN)
        existingStocksMap.set(key, { id: stock.id, quantity: stock.quantity })
      })
      
      skip += batchSize
      if (batch.length < batchSize) break
      
      // Задержка для освобождения памяти между батчами
      await new Promise(resolve => setImmediate(resolve))
    }
    
    console.log(`Загружено ${existingStocksMap.size} существующих записей stock`)

    // Статистика импорта
    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string; data?: string }> = []
    const csvStockKeys = new Set<string>()
    const startTime = Date.now()

    // Батчинг для операций с БД (уменьшено для экономии памяти)
    const BATCH_SIZE = 100
    const createBatch: Array<{ warehouse: string; nomenclature: string; article: string; quantity: number; clientTIN: string }> = []
    const updateBatch: Array<{ id: string; quantity: number }> = []

    // Функция для обработки батчей
    async function processBatches() {
      // Создаем новые записи батчем
      if (createBatch.length > 0) {
        await prisma.stock.createMany({
          data: createBatch,
          skipDuplicates: true,
        })
        imported += createBatch.length
        createBatch.length = 0
      }

      // Обновляем записи по одной (Prisma не поддерживает bulk update)
      for (const update of updateBatch) {
        try {
          await prisma.stock.update({
            where: { id: update.id },
            data: { quantity: update.quantity },
          })
          updated++
        } catch (error) {
          errors++
        }
      }
      updateBatch.length = 0
    }

    // Создаем поток для обработки CSV с декодированием
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
      async transform(record: StockCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          // Отладка первой записи данных
          if (isFirstDataRecord) {
            isFirstDataRecord = false
            console.log('Первая запись данных:', JSON.stringify(record, null, 2))
            console.log('Ключи записи:', Object.keys(record))
            console.log('Тип записи:', typeof record)
          }
          
          const rawWarehouse = record.Склад ? cleanValue(String(record.Склад)) : ''
          const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
          const rawNomenclature = record.Наименование ? cleanValue(String(record.Наименование)) : ''
          const rawArticle = record.Артикул ? cleanValue(String(record.Артикул)) : ''
          const rawQuantity = record.Колво ? String(record.Колво) : '0'

          // Валидация
          if (!rawWarehouse || !rawClientTIN || !rawNomenclature || !rawArticle) {
            if (rowNumber <= 5) {
              console.log(`Строка ${rowNumber}: Пропущена. Значения: Склад="${rawWarehouse}", ИНН="${rawClientTIN}", Наименование="${rawNomenclature}", Артикул="${rawArticle}"`)
              console.log(`Строка ${rowNumber}: Ключи record:`, Object.keys(record))
            }
            skippedRecords.push({ 
              row: rowNumber, 
              reason: 'Отсутствуют обязательные поля' 
            })
            skipped++
            return callback()
          }

          const clientTIN = rawClientTIN.replace(/\D/g, '')
          if (!clientTIN || !clientTINsSet.has(clientTIN)) {
            skippedRecords.push({ 
              row: rowNumber, 
              reason: `Клиент с ИНН ${clientTIN} не найден` 
            })
            skipped++
            return callback()
          }

          const quantity = parseQuantity(rawQuantity)
          if (quantity < 0) {
            skippedRecords.push({ 
              row: rowNumber, 
              reason: `Некорректное количество: ${quantity}` 
            })
            skipped++
            return callback()
          }

          // Фильтрация по датам: пропускаем записи старше 3 месяцев
          // Для stock используем дату из CSV 'Дата приемки или отгрузки'
          if (filterLast3Months && dateThreshold) {
            const rawStockDate = record['Дата приемки или отгрузки'] ? String(record['Дата приемки или отгрузки']) : ''
            const stockDate = parseStockDate(rawStockDate)
            
            // Если дата не указана или старше 3 месяцев, пропускаем
            if (!stockDate || stockDate < dateThreshold) {
              skipped++
              return callback()
            }
          }

          const key = stockKey(rawWarehouse, rawNomenclature, rawArticle, clientTIN)
          csvStockKeys.add(key)

          const existingStock = existingStocksMap.get(key)
          
          if (existingStock) {
            if (existingStock.quantity !== quantity) {
              updateBatch.push({ id: existingStock.id, quantity })
              if (updateBatch.length >= BATCH_SIZE) {
                await processBatches()
              }
            }
          } else {
            // Проверяем в БД на случай дубликатов
            const existingInDb = await prisma.stock.findFirst({
              where: {
                warehouse: rawWarehouse,
                nomenclature: rawNomenclature,
                article: rawArticle,
                clientTIN: clientTIN,
              }
            })

            if (existingInDb) {
              if (existingInDb.quantity !== quantity) {
                updateBatch.push({ id: existingInDb.id, quantity })
                if (updateBatch.length >= BATCH_SIZE) {
                  await processBatches()
                }
              }
            } else {
              createBatch.push({
                warehouse: rawWarehouse,
                nomenclature: rawNomenclature,
                article: rawArticle,
                quantity: quantity,
                clientTIN: clientTIN,
              })
              
              if (createBatch.length >= BATCH_SIZE) {
                await processBatches()
              }
            }
          }

          // Прогресс каждые 1000 записей
          if (rowNumber % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(`Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Скорость: ${rate.toFixed(0)} зап/сек`)
          }
        } catch (error) {
          errors++
          skippedRecords.push({ 
            row: rowNumber, 
            reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}` 
          })
        }
        
        callback()
      },
    })

    // Запускаем потоковую обработку
    await pipeline(
      readStream,
      decodeStream,
      parser,
      processStream
    )

    // Обрабатываем оставшиеся батчи
    await processBatches()

    // Удаляем записи, которых нет в CSV
    // ВАЖНО: При фильтрации по последним 3 месяцам НЕ удаляем записи,
    // так как это режим частичного обновления, а не полной синхронизации.
    // Удаление может привести к потере данных, если CSV пустой или содержит только старые данные.
    let deleted = 0
    
    if (filterLast3Months && dateThreshold) {
      console.log('\nРежим фильтрации: пропускаем удаление записей (режим частичного обновления)')
      console.log('Удаление записей отключено для предотвращения потери данных при частичном импорте')
    } else {
      console.log('\nУдаляем записи, отсутствующие в CSV...')
      const deleteBatch: string[] = []
      
      for (const [key, stock] of existingStocksMap.entries()) {
        if (!csvStockKeys.has(key)) {
          deleteBatch.push(stock.id)
          if (deleteBatch.length >= BATCH_SIZE) {
            await prisma.stock.deleteMany({
              where: { id: { in: deleteBatch } }
            })
            deleted += deleteBatch.length
            deleteBatch.length = 0
          }
        }
      }
      
      if (deleteBatch.length > 0) {
        await prisma.stock.deleteMany({
          where: { id: { in: deleteBatch } }
        })
        deleted += deleteBatch.length
      }
      
      console.log(`Удалено ${deleted} записей, отсутствующих в CSV`)
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('\n=== Результаты импорта ===')
    console.log(`Создано новых: ${imported}`)
    console.log(`Обновлено: ${updated}`)
    console.log(`Удалено: ${deleted}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    console.log(`Время выполнения: ${totalDuration} сек`)

    // Сохраняем метаданные импорта
    const importTime = new Date()
    await prisma.importMetadata.upsert({
      where: { importType: 'stock' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'stock',
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
    })

    // Детальный отчет о пропущенных записях (первые 50)
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

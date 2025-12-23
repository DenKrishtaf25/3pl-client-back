import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

// Простая функция для генерации ID, похожего на cuid
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(6).toString('hex')
  return `c${timestamp}${random}`
}

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

// Функция для форматирования даты в строку для PostgreSQL (без конвертации часового пояса)
function formatDateForPostgres(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null
  const cleaned = dateStr.trim()
  
  // Формат: YYYY-MM-DD HH:mm:ss или YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = isoMatch
    // Возвращаем строку в формате PostgreSQL timestamp без time zone
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
  }
  
  // Формат: DD.MM.YYYY HH:mm или DD.MM.YYYY
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (dateMatch) {
    const [, day, month, year, hour = '0', minute = '0'] = dateMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`
  }
  
  return null
}

function parseDate(dateStr: string): Date | null {
  // Эта функция больше не используется для сохранения, только для совместимости
  // Все даты сохраняются через dateStrings в raw SQL
  const formatted = formatDateForPostgres(dateStr)
  if (!formatted) return null
  
  // Создаем Date объект для совместимости (не используется при сохранении)
  const date = new Date(formatted.replace(' ', 'T'))
  return !isNaN(date.getTime()) ? date : null
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
    const batchSize = 2000 // Уменьшено с 10000 для экономии памяти
    
    // ВСЕГДА фильтруем по последним 3 месяцам для экономии памяти
    const loadDateThreshold = filterLast3Months && dateThreshold 
      ? dateThreshold 
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Последние 90 дней по умолчанию
    
    console.log(`Загружаем существующие записи orders (только последние 3 месяца с ${loadDateThreshold.toLocaleDateString()})...`)
    while (true) {
      const whereClause: any = {
        OR: [
          { exportDate: { gte: loadDateThreshold } },
          { shipmentDate: { gte: loadDateThreshold } },
          { acceptanceDate: { gte: loadDateThreshold } },
        ]
      }

      const batch = await prisma.order.findMany({
        where: whereClause,
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
    
    console.log(`Загружено ${existingOrdersMap.size} существующих записей orders (только последние 3 месяца)`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvOrderKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 100 // Уменьшено с 500 для экономии памяти
    const createBatch: Array<{ data: any; dateStrings: { exportDate: string; shipmentDate?: string; acceptanceDate?: string } }> = []
    const updateBatch: Array<{ id: string; data: any; dateStrings: { exportDate?: string; shipmentDate?: string; acceptanceDate?: string } }> = []

    async function processBatches() {
      // Используем raw SQL для создания записей, чтобы избежать конвертации часового пояса
      if (createBatch.length > 0) {
        console.log(`Обрабатываем batch создания: ${createBatch.length} записей`)
        const createConcurrency = 50
        let batchErrors = 0
        for (let i = 0; i < createBatch.length; i += createConcurrency) {
          const batch = createBatch.slice(i, i + createConcurrency)
          const batchResults = await Promise.allSettled(
            batch.map(async (item) => {
              const params: any[] = []
              let paramIndex = 1
              let exportDateParam = ''
              let shipmentDateParam = 'NULL'
              let acceptanceDateParam = 'NULL'
              
              try {
                // Генерируем ID на стороне клиента (cuid-подобный формат)
                const orderId = generateId()
                
                // Начинаем с orderId как первого параметра
                params.push(orderId)
                let paramIndex = 2 // Начинаем с 2, так как $1 = orderId
                
                // Добавляем даты как строки
                params.push(item.dateStrings.exportDate)
                exportDateParam = `$${paramIndex}::timestamp`
                paramIndex++
                
                if (item.dateStrings.shipmentDate) {
                  params.push(item.dateStrings.shipmentDate)
                  shipmentDateParam = `$${paramIndex}::timestamp`
                  paramIndex++
                }
                
                if (item.dateStrings.acceptanceDate) {
                  params.push(item.dateStrings.acceptanceDate)
                  acceptanceDateParam = `$${paramIndex}::timestamp`
                  paramIndex++
                }
                
                // Добавляем остальные поля
                const baseParamIndex = paramIndex
                params.push(
                  item.data.branch,
                  item.data.orderType,
                  item.data.orderNumber,
                  item.data.kisNumber,
                  item.data.status,
                  item.data.packagesPlanned,
                  item.data.packagesActual,
                  item.data.linesPlanned,
                  item.data.linesActual,
                  item.data.counterparty,
                  item.data.clientTIN
                )
                
                // Проверяем соответствие количества параметров
                // 1 (orderId) + даты + 11 остальных полей
                const expectedParams = 1 + // orderId
                  1 + // exportDate
                  (shipmentDateParam !== 'NULL' ? 1 : 0) + // shipmentDate
                  (acceptanceDateParam !== 'NULL' ? 1 : 0) + // acceptanceDate
                  11 // остальные поля
                
                if (params.length !== expectedParams) {
                  throw new Error(`Несоответствие количества параметров: ожидается ${expectedParams}, получено ${params.length}`)
                }
                
                // Логируем первую запись для отладки
                if (imported === 0 && errors === 0) {
                  console.log(`\n=== Первая запись для INSERT ===`)
                  console.log(`OrderId: ${orderId}`)
                  console.log(`Параметры (${params.length}):`, params.slice(0, 5), '...')
                  console.log(`SQL параметры: exportDate=${exportDateParam}, shipmentDate=${shipmentDateParam}, acceptanceDate=${acceptanceDateParam}`)
                  console.log(`baseParamIndex=${baseParamIndex}, expectedParams=${expectedParams}`)
                  console.log(`Данные:`, JSON.stringify(item.data, null, 2))
                }
                
                // Выполняем INSERT с правильной нумерацией параметров
                await prisma.$executeRawUnsafe(`
                  INSERT INTO "order" (
                    id, created_at, updated_at,
                    export_date, shipment_date, acceptance_date,
                    branch, order_type, order_number, kis_number, status,
                    packages_planned, packages_actual, lines_planned, lines_actual,
                    counterparty, client_tin
                  ) VALUES (
                    $1, NOW(), NOW(),
                    ${exportDateParam}, ${shipmentDateParam}, ${acceptanceDateParam},
                    $${baseParamIndex}, $${baseParamIndex + 1}, $${baseParamIndex + 2}, $${baseParamIndex + 3}, $${baseParamIndex + 4},
                    $${baseParamIndex + 5}, $${baseParamIndex + 6}, $${baseParamIndex + 7}, $${baseParamIndex + 8},
                    $${baseParamIndex + 9}, $${baseParamIndex + 10}
                  )
                `, ...params)
                
                imported++
                return { success: true }
              } catch (error) {
                errors++
                const errorNum = errors
                if (errorNum <= 20) {
                  console.error(`\n=== Ошибка при создании записи #${errorNum} ===`)
                  console.error(`Ошибка:`, error instanceof Error ? error.message : String(error))
                  if (error instanceof Error && error.stack) {
                    console.error(`Stack:`, error.stack.split('\n').slice(0, 5).join('\n'))
                  }
                  console.error(`Параметры (${params.length}):`, params.slice(0, 5), '...')
                  console.error(`Данные:`, JSON.stringify(item.data, null, 2))
                  console.error(`SQL параметры: exportDate=${exportDateParam}, shipmentDate=${shipmentDateParam}, acceptanceDate=${acceptanceDateParam}, paramIndex=${paramIndex}`)
                }
                throw error // Пробрасываем ошибку, чтобы Promise.allSettled её поймал
              }
            })
          )
          
          // Обрабатываем результаты Promise.allSettled
          let successCount = 0
          let failCount = 0
          for (const result of batchResults) {
            if (result.status === 'fulfilled' && result.value?.success) {
              successCount++
            } else {
              failCount++
              if (failCount <= 5 && result.status === 'rejected') {
                console.error(`Promise rejected в батче:`, result.reason?.message || result.reason)
              }
            }
          }
          
          if (i === 0) {
            console.log(`Первый батч: успешно ${successCount}, ошибок ${failCount} из ${batch.length}`)
          }
        }
        createBatch.length = 0
      }

      // Используем raw queries для обновления дат, чтобы избежать конвертации часового пояса
      if (updateBatch.length > 0) {
        console.log(`Обрабатываем batch обновления: ${updateBatch.length} записей`)
      }
      const updateConcurrency = 50
      for (let i = 0; i < updateBatch.length; i += updateConcurrency) {
        const batch = updateBatch.slice(i, i + updateConcurrency)
        await Promise.all(
          batch.map(async (update) => {
            // Всегда используем raw query для правильного сохранения дат
            const dateParts: string[] = []
            const params: any[] = []
            try {
              let paramIndex = 1
              
              // Обрабатываем даты
              if (update.dateStrings?.exportDate) {
                dateParts.push(`export_date = $${paramIndex}::timestamp`)
                params.push(update.dateStrings.exportDate)
                paramIndex++
              } else {
                dateParts.push(`export_date = $${paramIndex}::timestamp`)
                params.push(update.data.exportDate)
                paramIndex++
              }
              
              if (update.dateStrings?.shipmentDate !== undefined) {
                if (update.dateStrings.shipmentDate) {
                  dateParts.push(`shipment_date = $${paramIndex}::timestamp`)
                  params.push(update.dateStrings.shipmentDate)
                  paramIndex++
                } else {
                  dateParts.push(`shipment_date = NULL`)
                }
              } else if (update.data.shipmentDate) {
                dateParts.push(`shipment_date = $${paramIndex}::timestamp`)
                params.push(update.data.shipmentDate)
                paramIndex++
              } else {
                dateParts.push(`shipment_date = NULL`)
              }
              
              if (update.dateStrings?.acceptanceDate !== undefined) {
                if (update.dateStrings.acceptanceDate) {
                  dateParts.push(`acceptance_date = $${paramIndex}::timestamp`)
                  params.push(update.dateStrings.acceptanceDate)
                  paramIndex++
                } else {
                  dateParts.push(`acceptance_date = NULL`)
                }
              } else if (update.data.acceptanceDate) {
                dateParts.push(`acceptance_date = $${paramIndex}::timestamp`)
                params.push(update.data.acceptanceDate)
                paramIndex++
              } else {
                dateParts.push(`acceptance_date = NULL`)
              }
              
              // Добавляем остальные поля
              const baseParamIndex = paramIndex
              params.push(
                update.data.branch,
                update.data.orderType,
                update.data.orderNumber,
                update.data.kisNumber,
                update.data.status,
                update.data.packagesPlanned,
                update.data.packagesActual,
                update.data.linesPlanned,
                update.data.linesActual,
                update.data.counterparty,
                update.id
              )
              
              // Обновляем через raw query с правильной нумерацией параметров
              await prisma.$executeRawUnsafe(`
                UPDATE "order" 
                SET ${dateParts.join(', ')},
                    branch = $${baseParamIndex},
                    order_type = $${baseParamIndex + 1},
                    order_number = $${baseParamIndex + 2},
                    kis_number = $${baseParamIndex + 3},
                    status = $${baseParamIndex + 4},
                    packages_planned = $${baseParamIndex + 5},
                    packages_actual = $${baseParamIndex + 6},
                    lines_planned = $${baseParamIndex + 7},
                    lines_actual = $${baseParamIndex + 8},
                    counterparty = $${baseParamIndex + 9}
                WHERE id = $${baseParamIndex + 10}
              `, ...params)
              
              updated++
            } catch (error) {
              errors++
              if (errors <= 10) {
                console.error(`Ошибка при обновлении записи:`, error)
                console.error(`ID:`, update.id)
                console.error(`Параметры:`, params)
              }
            }
          })
        )
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
            // Удаляем BOM (UTF-8 SIG) если есть
            if (chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
              chunk = chunk.slice(3)
            }
          }
          // Декодируем как UTF-8
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
      bom: true, // Автоматически удаляет BOM (UTF-8 SIG)
      quote: '"', // Явно указываем кавычки
      escape: '"', // Экранирование кавычек
    })

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
            if (rowNumber <= 10) {
              console.log(`Строка ${rowNumber}: Пропущена - отсутствуют обязательные поля`)
              console.log(`  Филиал="${rawBranch}", ИНН="${rawClientTIN}", Тип="${rawOrderType}", Номер="${rawOrderNumber}", Статус="${rawStatus}"`)
              console.log(`  Ключи record:`, Object.keys(record))
              console.log(`  Все значения record:`, record)
            }
            skippedRecords.push({ row: rowNumber, reason: 'Отсутствуют обязательные поля' })
            skipped++
            return callback()
          }

          const clientTIN = rawClientTIN.replace(/\D/g, '')
          if (!clientTIN || !clientTINsSet.has(clientTIN)) {
            if (rowNumber <= 10) {
              console.log(`Строка ${rowNumber}: Пропущена - клиент с ИНН "${clientTIN}" (из "${rawClientTIN}") не найден в БД`)
              console.log(`  Всего клиентов в БД: ${clientTINsSet.size}`)
            }
            skippedRecords.push({ row: rowNumber, reason: `Клиент с ИНН ${clientTIN} не найден` })
            skipped++
            return callback()
          }

          // Получаем строковые представления дат для прямого сохранения в PostgreSQL
          const exportDateStr = formatDateForPostgres(rawExportDate) || formatDateForPostgres(new Date().toISOString().split('T')[0] + ' 00:00:00')
          const shipmentDateStr = formatDateForPostgres(rawShipmentDate)
          const acceptanceDateStr = formatDateForPostgres(rawAcceptanceDate)
          
          // Также создаем Date объекты для совместимости с Prisma
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
              if (rowNumber <= 10) {
                console.log(`Строка ${rowNumber}: Пропущена - дата старше 3 месяцев`)
                console.log(`  exportDate: ${exportDate}, shipmentDate: ${shipmentDate}, acceptanceDate: ${acceptanceDate}`)
                console.log(`  Порог: ${dateThreshold}`)
              }
              skipped++
              return callback()
            }
          }
          
          const packagesPlanned = parseInteger(rawPackagesPlanned)
          const packagesActual = parseInteger(rawPackagesActual)
          const linesPlanned = parseInteger(rawLinesPlanned)
          const linesActual = parseInteger(rawLinesActual)

          const key = orderKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
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
              },
              dateStrings: {
                exportDate: exportDateStr || undefined,
                shipmentDate: shipmentDateStr || undefined,
                acceptanceDate: acceptanceDateStr || undefined,
              }
            })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            // Если запись не найдена в памяти, добавляем в createBatch с dateStrings
            createBatch.push({
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber || '',
                status: rawStatus,
                packagesPlanned,
                packagesActual,
                linesPlanned,
                linesActual,
                counterparty: rawCounterparty || 'Не указан',
                clientTIN,
              },
              dateStrings: {
                exportDate: exportDateStr!,
                shipmentDate: shipmentDateStr || undefined,
                acceptanceDate: acceptanceDateStr || undefined,
              }
            })
            if (createBatch.length >= BATCH_SIZE) await processBatches()
          }

          if (rowNumber % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(`Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Пропущено: ${skipped} | Скорость: ${rate.toFixed(0)} зап/сек`)
          }
          
          // Логируем первые несколько успешно обработанных записей
          if (rowNumber <= 5) {
            console.log(`Строка ${rowNumber}: Успешно обработана`)
            console.log(`  Филиал: ${rawBranch}, Тип: ${rawOrderType}, Номер: ${rawOrderNumber}`)
            console.log(`  ИНН: ${clientTIN}, Статус: ${rawStatus}`)
            console.log(`  Будет создана: ${!existingOrder}, Будет обновлена: ${!!existingOrder}`)
          }
        } catch (error) {
          errors++
          skippedRecords.push({ row: rowNumber, reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}` })
        }
        callback()
      },
    })

    await pipeline(readStream, decodeStream, parser, processStream)
    
    console.log(`\nОбработка CSV завершена. Всего строк обработано: ${rowNumber}`)
    console.log(`Записей в createBatch: ${createBatch.length}`)
    console.log(`Записей в updateBatch: ${updateBatch.length}`)
    
    await processBatches()
    
    console.log(`После processBatches: Импортировано: ${imported}, Обновлено: ${updated}`)

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

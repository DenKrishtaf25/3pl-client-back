import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

const prisma = new PrismaClient()

interface OrderCsvRow {
  Филиал: string
  'Тип заказа': string
  'Номер заказа': string
  'Номер заказа КИС': string
  'Дата выгрузки заказа': string
  'Заявленная дата отгрузки': string
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

// Функция для парсинга числа (целое число)
function parseInteger(value: string): number {
  if (!value) return 0
  
  // Убираем пробелы и запятые
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '')
  
  // Парсим число
  const num = parseInt(cleaned, 10)
  
  return isNaN(num) ? 0 : num
}

async function main() {
  try {
    // Читаем CSV файл с правильной кодировкой
    const csvFilePath = join(process.cwd(), 'table_data', 'orders.csv')
    
    // Пробуем прочитать файл в разных кодировках
    let fileContent: string
    const buffer = readFileSync(csvFilePath)
    
    // Убираем BOM (Byte Order Mark) если есть (для UTF-8-sig)
    let bufferWithoutBOM = buffer
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      bufferWithoutBOM = buffer.slice(3)
      console.log('Обнаружен UTF-8 BOM, удаляем...')
    } else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      bufferWithoutBOM = buffer.slice(2)
      console.log('Обнаружен UTF-16 LE BOM, удаляем...')
    } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      bufferWithoutBOM = buffer.slice(2)
      console.log('Обнаружен UTF-16 BE BOM, удаляем...')
    }
    
    // Пробуем сначала Windows-1251 (обычно для русских CSV файлов из Excel)
    try {
      fileContent = iconv.decode(bufferWithoutBOM, 'win1251')
      if (!fileContent || fileContent.length === 0) {
        throw new Error('Пустой файл после декодирования')
      }
      // Проверяем, что русские символы читаются правильно
      if (!fileContent.includes('Филиал') && !fileContent.includes('ИНН')) {
        throw new Error('Русские символы не читаются правильно в win1251')
      }
      console.log('Файл успешно декодирован как Windows-1251')
    } catch (error) {
      // Если не получилось с Windows-1251, пробуем UTF-8
      try {
        fileContent = bufferWithoutBOM.toString('utf-8')
        // Проверяем, что русские символы читаются правильно
        if (!fileContent.includes('Филиал') && !fileContent.includes('ИНН')) {
          throw new Error('Русские символы не читаются правильно в UTF-8')
        }
        console.log('Файл успешно декодирован как UTF-8')
      } catch (e) {
        // Если и это не помогло, пробуем latin1 как последний вариант
        fileContent = bufferWithoutBOM.toString('latin1')
        console.log('Файл декодирован как latin1 (возможны проблемы с русскими символами)')
      }
    }

    // Парсим CSV с разделителем точка с запятой
    const records: OrderCsvRow[] = parse(fileContent, {
      delimiter: ';',
      columns: true, // Используем первую строку как заголовки
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Разрешаем разное количество колонок
    })

    console.log(`Найдено ${records.length} записей в CSV файле`)
    console.log('Загружаем список клиентов для проверки...')

    // Загружаем все клиенты в память для быстрой проверки
    const allClients = await prisma.client.findMany({
      select: { TIN: true }
    })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов для проверки\n`)

    // Загружаем все существующие записи orders для сравнения
    console.log('Загружаем существующие записи orders для сравнения...')
    const existingOrders = await prisma.order.findMany({
      select: {
        id: true,
        branch: true,
        orderType: true,
        orderNumber: true,
        clientTIN: true,
      }
    })
    
    // Функция для создания уникального ключа записи
    const orderKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`
    
    // Создаем Map для быстрого поиска по ключу (branch + orderType + orderNumber + clientTIN)
    const existingOrdersMap = new Map<string, { id: string }>()
    existingOrders.forEach(order => {
      const key = orderKey(order.branch, order.orderType, order.orderNumber, order.clientTIN)
      existingOrdersMap.set(key, { id: order.id })
    })
    console.log(`Загружено ${existingOrdersMap.size} существующих записей orders\n`)

    // Создаем Set для отслеживания записей из CSV
    const csvOrderKeys = new Set<string>()

    // Импортируем данные в базу
    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    const skippedRecords: Array<{ row: number; reason: string; data?: string }> = []
    const startTime = Date.now()

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      
      try {
        // Извлекаем данные из записи
        const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
        const rawOrderType = record['Тип заказа'] ? cleanValue(String(record['Тип заказа'])) : ''
        const rawOrderNumber = record['Номер заказа'] ? cleanValue(String(record['Номер заказа'])) : ''
        const rawKisNumber = record['Номер заказа КИС'] ? cleanValue(String(record['Номер заказа КИС'])) : ''
        const rawExportDate = record['Дата выгрузки заказа'] ? String(record['Дата выгрузки заказа']) : ''
        const rawShipmentDate = record['Заявленная дата отгрузки'] ? String(record['Заявленная дата отгрузки']) : ''
        const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
        const rawPackagesPlanned = record.КоличествоУпаковокПлан ? String(record.КоличествоУпаковокПлан) : '0'
        const rawPackagesActual = record.КоличествоУпаковокФакт ? String(record.КоличествоУпаковокФакт) : '0'
        const rawLinesPlanned = record.КоличествоСтрокПлан ? String(record.КоличествоСтрокПлан) : '0'
        const rawLinesActual = record.КоличествоСтрокФакт ? String(record.КоличествоСтрокФакт) : '0'
        const rawCounterparty = record.Контрагент ? cleanValue(String(record.Контрагент)) : ''
        const rawAcceptanceDate = record['Дата приемки/отгрузки'] ? String(record['Дата приемки/отгрузки']) : ''
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''

        // Проверяем обязательные поля
        if (!rawBranch) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует филиал)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует филиал' })
          skipped++
          continue
        }

        if (!rawClientTIN) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует ИНН клиента)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует ИНН клиента' })
          skipped++
          continue
        }

        // Очищаем TIN (убираем все нецифровые символы)
        const clientTIN = rawClientTIN.replace(/\D/g, '')
        
        if (!clientTIN || clientTIN.length === 0) {
          const reason = `Неверный формат ИНН: "${rawClientTIN}"`
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason, data: `${rawClientTIN}; ${rawBranch}` })
          skipped++
          continue
        }

        // Проверяем, существует ли клиент с таким TIN (быстрая проверка в памяти)
        if (!clientTINsSet.has(clientTIN)) {
          const reason = `Клиент с ИНН ${clientTIN} не найден в базе данных`
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason, data: `${clientTIN}; ${rawCounterparty}` })
          skipped++
          continue
        }

        if (!rawOrderType) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует тип заказа)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует тип заказа' })
          skipped++
          continue
        }

        if (!rawOrderNumber) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует номер заказа)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует номер заказа' })
          skipped++
          continue
        }

        if (!rawStatus) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует статус)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует статус' })
          skipped++
          continue
        }

        // Парсим даты
        const exportDate = parseDate(rawExportDate)
        const shipmentDate = parseDate(rawShipmentDate)
        const acceptanceDate = parseDate(rawAcceptanceDate)

        // exportDate обязательное поле, для пустого используем текущую дату
        // shipmentDate и acceptanceDate - опциональные, оставляем null если пусто
        const finalExportDate = exportDate || new Date()
        const finalShipmentDate = shipmentDate || null
        const finalAcceptanceDate = acceptanceDate || null

        // Парсим числовые поля
        const packagesPlanned = parseInteger(rawPackagesPlanned)
        const packagesActual = parseInteger(rawPackagesActual)
        const linesPlanned = parseInteger(rawLinesPlanned)
        const linesActual = parseInteger(rawLinesActual)

        // Создаем ключ для поиска
        const key = orderKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
        csvOrderKeys.add(key)

        // Проверяем, существует ли запись
        const existingOrder = existingOrdersMap.get(key)

        if (existingOrder) {
          // Запись существует - обновляем ее
          await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              branch: rawBranch,
              orderType: rawOrderType,
              orderNumber: rawOrderNumber,
              kisNumber: rawKisNumber || '',
              exportDate: finalExportDate,
              shipmentDate: finalShipmentDate,
              status: rawStatus,
              packagesPlanned: packagesPlanned,
              packagesActual: packagesActual,
              linesPlanned: linesPlanned,
              linesActual: linesActual,
              counterparty: rawCounterparty || 'Не указан',
              acceptanceDate: finalAcceptanceDate,
            },
          })
          updated++
        } else {
          // Запись не найдена в Map - проверяем в БД на случай дубликатов
          const existingInDb = await prisma.order.findFirst({
            where: {
              branch: rawBranch,
              orderType: rawOrderType,
              orderNumber: rawOrderNumber,
              clientTIN: clientTIN,
            }
          })

          if (existingInDb) {
            // Запись найдена в БД - обновляем ее
            await prisma.order.update({
              where: { id: existingInDb.id },
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber || '',
                exportDate: finalExportDate,
                shipmentDate: finalShipmentDate,
                status: rawStatus,
                packagesPlanned: packagesPlanned,
                packagesActual: packagesActual,
                linesPlanned: linesPlanned,
                linesActual: linesActual,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate: finalAcceptanceDate,
              },
            })
            updated++
          } else {
            // Записи действительно нет - создаем новую
            await prisma.order.create({
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber || '',
                exportDate: finalExportDate,
                shipmentDate: finalShipmentDate,
                status: rawStatus,
                packagesPlanned: packagesPlanned,
                packagesActual: packagesActual,
                linesPlanned: linesPlanned,
                linesActual: linesActual,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate: finalAcceptanceDate,
                clientTIN: clientTIN,
                // createdAt и updatedAt будут созданы автоматически
              },
            })
            imported++
          }
        }

        // Показываем прогресс каждые 1000 записей
        if ((i + 1) % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          const rate = ((i + 1) / (Date.now() - startTime)) * 1000
          const remaining = Math.round((records.length - i - 1) / rate)
          console.log(`Обработано ${i + 1}/${records.length} записей (${((i + 1) / records.length * 100).toFixed(1)}%) | Импортировано: ${imported} | Обновлено: ${updated} | Скорость: ${rate.toFixed(0)} зап/сек | Осталось: ~${remaining} сек`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`Строка ${i + 2}: ошибка при импорте:`, errorMessage)
        skippedRecords.push({ 
          row: i + 2, 
          reason: `Ошибка: ${errorMessage}`, 
          data: record ? JSON.stringify(record).substring(0, 100) : 'нет данных'
        })
        errors++
      }
    }

    // Удаляем записи, которых нет в CSV
    console.log('\nУдаляем записи, отсутствующие в CSV...')
    let deleted = 0
    for (const [key, order] of existingOrdersMap.entries()) {
      if (!csvOrderKeys.has(key)) {
        await prisma.order.delete({
          where: { id: order.id },
        })
        deleted++
      }
    }
    console.log(`Удалено ${deleted} записей, отсутствующих в CSV\n`)

    console.log('\n=== Результаты импорта ===')
    console.log(`Создано новых: ${imported}`)
    console.log(`Обновлено: ${updated}`)
    console.log(`Удалено: ${deleted}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    
    // Сохраняем метаданные импорта
    const importTime = new Date()
    await prisma.importMetadata.upsert({
      where: { importType: 'orders' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'orders',
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
    })
    console.log(`\nМетаданные импорта сохранены: ${importTime.toISOString()}`)
    
    // Детальный отчет о пропущенных записях (первые 50)
    if (skippedRecords.length > 0) {
      console.log('\n=== Детализация пропущенных записей (первые 50) ===')
      const recordsToShow = skippedRecords.slice(0, 50)
      recordsToShow.forEach(({ row, reason, data }) => {
        console.log(`\nСтрока ${row}:`)
        console.log(`  Причина: ${reason}`)
        if (data) {
          console.log(`  Данные: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`)
        }
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


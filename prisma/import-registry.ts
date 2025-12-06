import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

const prisma = new PrismaClient()

interface RegistryCsvRow {
  Филиал: string
  Контрагент: string
  ИНН: string
  'Номер ТС': string
  'Тип прихода': string
  'Номер заказа или маршрутного листа': string
  'ФИО водителя': string
  'Тип Обработки': string
  'Дата прибытия ТС по заявке': string
  'Дата планового прибытия ТС': string
  'Дата фактического прибытия ТС': string
  'Дата убытия ТС': string
  'Статус ТС': string
}

// Функция для очистки значения
function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

// Функция для парсинга даты (формат: DD.MM.YYYY HH:mm или DD.MM.YYYY)
function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  
  const cleaned = dateStr.trim()
  
  // Формат: DD.MM.YYYY HH:mm или DD.MM.YYYY
  const dateMatch = cleaned.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  
  if (!dateMatch) return null
  
  const [, day, month, year, hour = '0', minute = '0'] = dateMatch
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute)
  )
  
  // Проверяем, что дата валидна
  if (isNaN(date.getTime())) return null
  
  return date
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
    const csvFilePath = join(process.cwd(), 'table_data', 'registry.csv')
    
    // Пробуем прочитать файл в разных кодировках
    let fileContent: string
    const buffer = readFileSync(csvFilePath)
    
    // Пробуем сначала Windows-1251 (обычно для русских CSV файлов из Excel)
    try {
      fileContent = iconv.decode(buffer, 'win1251')
      if (!fileContent || fileContent.length === 0) {
        throw new Error('Пустой файл после декодирования')
      }
    } catch (error) {
      // Если не получилось с Windows-1251, пробуем UTF-8
      try {
        fileContent = buffer.toString('utf-8')
      } catch (e) {
        // Если и это не помогло, пробуем latin1 как последний вариант
        fileContent = buffer.toString('latin1')
      }
    }

    // Парсим CSV с разделителем точка с запятой
    const records: RegistryCsvRow[] = parse(fileContent, {
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

    // Загружаем все существующие записи registry для сравнения
    console.log('Загружаем существующие записи registry для сравнения...')
    const existingRegistries = await prisma.registry.findMany({
      select: {
        id: true,
        branch: true,
        orderType: true,
        orderNumber: true,
        clientTIN: true,
      }
    })
    
    // Функция для создания уникального ключа записи
    const registryKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`
    
    // Создаем Map для быстрого поиска по ключу (branch + orderType + orderNumber + clientTIN)
    const existingRegistriesMap = new Map<string, { id: string }>()
    existingRegistries.forEach(registry => {
      const key = registryKey(registry.branch, registry.orderType, registry.orderNumber, registry.clientTIN)
      existingRegistriesMap.set(key, { id: registry.id })
    })
    console.log(`Загружено ${existingRegistriesMap.size} существующих записей registry\n`)

    // Создаем Set для отслеживания записей из CSV
    const csvRegistryKeys = new Set<string>()

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
        const rawCounterparty = record.Контрагент ? cleanValue(String(record.Контрагент)) : ''
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
        const rawVehicleNumber = record['Номер ТС'] ? cleanValue(String(record['Номер ТС'])) : ''
        const rawOrderType = record['Тип прихода'] ? cleanValue(String(record['Тип прихода'])) : ''
        const rawOrderNumber = record['Номер заказа или маршрутного листа'] ? cleanValue(String(record['Номер заказа или маршрутного листа'])) : ''
        const rawDriverName = record['ФИО водителя'] ? cleanValue(String(record['ФИО водителя'])) : ''
        const rawProcessingType = record['Тип Обработки'] ? cleanValue(String(record['Тип Обработки'])) : ''
        const rawKisNumber = '' // Нет в CSV, используем пустое значение
        const rawUnloadingDate = record['Дата фактического прибытия ТС'] ? String(record['Дата фактического прибытия ТС']) : ''
        const rawStatus = record['Статус ТС'] ? cleanValue(String(record['Статус ТС'])) : ''
        const rawAcceptanceDate = record['Дата прибытия ТС по заявке'] ? String(record['Дата прибытия ТС по заявке']) : ''
        const rawShipmentPlan = record['Дата планового прибытия ТС'] ? String(record['Дата планового прибытия ТС']) : ''
        const rawDepartureDate = record['Дата убытия ТС'] ? String(record['Дата убытия ТС']) : ''
        const rawPackagesPlanned = '0' // Нет в CSV
        const rawPackagesActual = '0' // Нет в CSV
        const rawLinesPlanned = '0' // Нет в CSV
        const rawLinesActual = '0' // Нет в CSV

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
            console.log(`Строка ${i + 2}: пропущена (Отсутствует тип прихода)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует тип прихода' })
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
        const unloadingDate = parseDate(rawUnloadingDate)
        const acceptanceDate = parseDate(rawAcceptanceDate)
        const shipmentPlan = parseDate(rawShipmentPlan)
        const departureDate = parseDate(rawDepartureDate)

        // Для обязательных дат в схеме используем текущую дату если нет данных
        const finalUnloadingDate = unloadingDate || new Date()
        const finalAcceptanceDate = acceptanceDate || new Date()
        const finalShipmentPlan = shipmentPlan || new Date()

        // Парсим числовые поля
        const packagesPlanned = parseInteger(rawPackagesPlanned)
        const packagesActual = parseInteger(rawPackagesActual)
        const linesPlanned = parseInteger(rawLinesPlanned)
        const linesActual = parseInteger(rawLinesActual)

        // Создаем ключ для поиска
        const key = registryKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
        csvRegistryKeys.add(key)

        // Проверяем, существует ли запись
        const existingRegistry = existingRegistriesMap.get(key)

        if (existingRegistry) {
          // Запись существует - обновляем ее
          await prisma.registry.update({
            where: { id: existingRegistry.id },
            data: {
              branch: rawBranch,
              orderType: rawOrderType,
              orderNumber: rawOrderNumber,
              kisNumber: rawKisNumber,
              unloadingDate: finalUnloadingDate,
              status: rawStatus,
              counterparty: rawCounterparty || 'Не указан',
              acceptanceDate: finalAcceptanceDate,
              shipmentPlan: finalShipmentPlan,
              packagesPlanned: packagesPlanned,
              packagesActual: packagesActual,
              linesPlanned: linesPlanned,
              linesActual: linesActual,
              vehicleNumber: rawVehicleNumber || null,
              driverName: rawDriverName || null,
              processingType: rawProcessingType || null,
              departureDate: departureDate,
            },
          })
          updated++
        } else {
          // Запись не найдена в Map - проверяем в БД на случай дубликатов
          const existingInDb = await prisma.registry.findFirst({
            where: {
              branch: rawBranch,
              orderType: rawOrderType,
              orderNumber: rawOrderNumber,
              clientTIN: clientTIN,
            }
          })

          if (existingInDb) {
            // Запись найдена в БД - обновляем ее
            await prisma.registry.update({
              where: { id: existingInDb.id },
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber,
                unloadingDate: finalUnloadingDate,
                status: rawStatus,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate: finalAcceptanceDate,
                shipmentPlan: finalShipmentPlan,
                packagesPlanned: packagesPlanned,
                packagesActual: packagesActual,
                linesPlanned: linesPlanned,
                linesActual: linesActual,
                vehicleNumber: rawVehicleNumber || null,
                driverName: rawDriverName || null,
                processingType: rawProcessingType || null,
                departureDate: departureDate,
              },
            })
            updated++
          } else {
            // Записи действительно нет - создаем новую
            await prisma.registry.create({
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber,
                unloadingDate: finalUnloadingDate,
                status: rawStatus,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate: finalAcceptanceDate,
                shipmentPlan: finalShipmentPlan,
                packagesPlanned: packagesPlanned,
                packagesActual: packagesActual,
                linesPlanned: linesPlanned,
                linesActual: linesActual,
                vehicleNumber: rawVehicleNumber || null,
                driverName: rawDriverName || null,
                processingType: rawProcessingType || null,
                departureDate: departureDate,
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
    for (const [key, registry] of existingRegistriesMap.entries()) {
      if (!csvRegistryKeys.has(key)) {
        await prisma.registry.delete({
          where: { id: registry.id },
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
      where: { importType: 'registry' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'registry',
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


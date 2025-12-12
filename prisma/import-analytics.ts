import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

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

// Функция для очистки значения
function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

// Функция для парсинга даты (поддерживает DD.MM.YYYY и YYYY-MM-DD)
function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  
  const cleaned = dateStr.trim()
  
  // Пробуем формат ISO: YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    )
    if (!isNaN(date.getTime())) {
      return date
    }
  }
  
  // Пробуем формат: DD.MM.YYYY
  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (dateMatch) {
    const [, day, month, year] = dateMatch
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
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
    const csvFilePath = join(process.cwd(), 'table_data', 'analytics.csv')
    
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
    const records: AnalyticsCsvRow[] = parse(fileContent, {
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

    // Загружаем все существующие записи analytics для сравнения
    console.log('Загружаем существующие записи analytics для сравнения...')
    const existingAnalytics = await prisma.analytics.findMany({
      select: {
        id: true,
        branch: true,
        clientTIN: true,
        date: true,
      }
    })
    
    // Функция для создания уникального ключа записи
    const analyticsKey = (b: string, t: string, d: Date) => `${b}|${t}|${d.toISOString().split('T')[0]}`
    
    // Создаем Map для быстрого поиска по ключу (branch + clientTIN + date)
    const existingAnalyticsMap = new Map<string, { id: string }>()
    existingAnalytics.forEach(analytics => {
      const key = analyticsKey(analytics.branch, analytics.clientTIN, analytics.date)
      existingAnalyticsMap.set(key, { id: analytics.id })
    })
    console.log(`Загружено ${existingAnalyticsMap.size} существующих записей analytics\n`)

    // Создаем Set для отслеживания записей из CSV
    const csvAnalyticsKeys = new Set<string>()

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
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
        const rawDate = record.Дата ? String(record.Дата) : ''
        const rawQuantityByRequest = record.КолвоПоЗаявке ? String(record.КолвоПоЗаявке) : '0'
        const rawQuantityByPlan = record.КолвоПоПлану ? String(record.КолвоПоПлану) : '0'
        const rawQuantityByFact = record.КолвоПоФакту ? String(record.КолвоПоФакту) : '0'
        const rawQuantityByDeparture = record.КолвоПоУбытию ? String(record.КолвоПоУбытию) : '0'

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
          skippedRecords.push({ row: i + 2, reason, data: `${clientTIN}; ${rawBranch}` })
          skipped++
          continue
        }

        // Парсим дату
        const date = parseDate(rawDate)

        if (!date) {
          const reason = `Неверный формат даты: "${rawDate}"`
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason, data: `${rawDate}; ${rawBranch}` })
          skipped++
          continue
        }

        // Парсим числовые поля
        const quantityByRequest = parseInteger(rawQuantityByRequest)
        const quantityByPlan = parseInteger(rawQuantityByPlan)
        const quantityByFact = parseInteger(rawQuantityByFact)
        const quantityByDeparture = parseInteger(rawQuantityByDeparture)

        // Создаем ключ для поиска
        const key = analyticsKey(rawBranch, clientTIN, date)
        csvAnalyticsKeys.add(key)

        // Проверяем, существует ли запись
        const existingAnalytics = existingAnalyticsMap.get(key)

        if (existingAnalytics) {
          // Запись существует - обновляем ее
          await prisma.analytics.update({
            where: { id: existingAnalytics.id },
            data: {
              quantityByRequest: quantityByRequest,
              quantityByPlan: quantityByPlan,
              quantityByFact: quantityByFact,
              quantityByDeparture: quantityByDeparture,
            },
          })
          updated++
        } else {
          // Запись не найдена в Map - проверяем в БД на случай дубликатов
          const existingInDb = await prisma.analytics.findFirst({
            where: {
              branch: rawBranch,
              clientTIN: clientTIN,
              date: date,
            }
          })

          if (existingInDb) {
            // Запись найдена в БД - обновляем ее
            await prisma.analytics.update({
              where: { id: existingInDb.id },
              data: {
                quantityByRequest: quantityByRequest,
                quantityByPlan: quantityByPlan,
                quantityByFact: quantityByFact,
                quantityByDeparture: quantityByDeparture,
              },
            })
            updated++
          } else {
            // Записи действительно нет - создаем новую
            await prisma.analytics.create({
              data: {
                branch: rawBranch,
                date: date,
                quantityByRequest: quantityByRequest,
                quantityByPlan: quantityByPlan,
                quantityByFact: quantityByFact,
                quantityByDeparture: quantityByDeparture,
                clientTIN: clientTIN,
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
    for (const [key, analytics] of existingAnalyticsMap.entries()) {
      if (!csvAnalyticsKeys.has(key)) {
        await prisma.analytics.delete({
          where: { id: analytics.id },
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
      where: { importType: 'analytics' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'analytics',
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


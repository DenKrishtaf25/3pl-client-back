import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

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

// Функция для парсинга суммы (десятичное число)
function parseDecimal(value: string): number {
  if (!value) return 0
  
  // Заменяем запятую на точку и убираем пробелы
  const cleaned = value.trim().replace(/,/g, '.').replace(/\s/g, '')
  
  // Парсим число
  const num = parseFloat(cleaned)
  
  return isNaN(num) ? 0 : num
}

async function main() {
  try {
    // Читаем CSV файл с правильной кодировкой
    const csvFilePath = join(process.cwd(), 'table_data', 'finance.csv')
    
    // Пробуем прочитать файл в разных кодировках
    let fileContent: string
    const buffer = readFileSync(csvFilePath)
    
    // Убираем BOM (Byte Order Mark) если есть
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

    // Показываем первые строки файла для отладки
    const firstLines = fileContent.split('\n').slice(0, 3)
    console.log('Первые строки файла:')
    firstLines.forEach((line, idx) => {
      console.log(`  Строка ${idx + 1}: ${line.substring(0, 200)}${line.length > 200 ? '...' : ''}`)
    })

    // Парсим CSV с разделителем точка с запятой
    const records: FinanceCsvRow[] = parse(fileContent, {
      delimiter: ';',
      columns: true, // Используем первую строку как заголовки
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Разрешаем разное количество колонок
    })

    // Отладочный вывод: показываем названия колонок из первой записи
    let completionDateColumnName: string | null = null
    let closingDateColumnName: string | null = null
    
    if (records.length > 0) {
      const columnNames = Object.keys(records[0])
      console.log('\nНайденные колонки в CSV:', columnNames)
      console.log('Пример первой записи:', JSON.stringify(records[0], null, 2))
      
      // Проверяем, что все необходимые колонки присутствуют
      const requiredColumns = ['Филиал', 'Клиент', 'ИНН', 'ДатаПоступления', 'КодПретензии', 'СуммаПретензии', 'Статус']
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
      
      // Проверяем наличие новых колонок (опциональных) - ищем разные варианты названий
      const findColumn = (variants: string[]): string | null => {
        for (const variant of variants) {
          const found = columnNames.find(col => {
            const colTrimmed = col.trim()
            const variantTrimmed = variant.trim()
            // Точное совпадение
            if (colTrimmed === variantTrimmed) return true
            // Без учета регистра
            if (colTrimmed.toLowerCase() === variantTrimmed.toLowerCase()) return true
            // Без пробелов и подчеркиваний
            const colNormalized = colTrimmed.replace(/[\s_]/g, '').toLowerCase()
            const variantNormalized = variantTrimmed.replace(/[\s_]/g, '').toLowerCase()
            if (colNormalized === variantNormalized) return true
            return false
          })
          if (found) return found
        }
        return null
      }
      
      completionDateColumnName = findColumn([
        'ДатаЗавершения', 
        'Дата завершения', 
        'Дата Завершения',
        'дата_завершения',
        'Дата_завершения',
        'дата завершения'
      ])
      closingDateColumnName = findColumn([
        'ДатаЗакрытия', 
        'Дата закрытия', 
        'Дата Закрытия',
        'ПлановаяДатаЗакрытия',
        'Плановая Дата Закрытия',
        'Плановая дата закрытия',
        'дата_закрытия',
        'Дата_закрытия'
      ])
      
      if (completionDateColumnName) {
        console.log(`Обнаружена колонка для даты завершения: "${completionDateColumnName}"`)
      } else {
        console.log('Колонка для даты завершения не найдена (будет пропущена)')
      }
      if (closingDateColumnName) {
        console.log(`Обнаружена колонка для даты закрытия: "${closingDateColumnName}"`)
      } else {
        console.log('Колонка для даты закрытия не найдена (будет пропущена)')
      }
      
      if (missingColumns.length > 0) {
        console.error('\nОШИБКА: Отсутствуют необходимые колонки:', missingColumns)
        console.error('Найденные колонки:', columnNames)
        console.error('\nВозможные причины:')
        console.error('1. Неправильная кодировка файла')
        console.error('2. Неправильные названия колонок в CSV')
        console.error('3. Проблемы с разделителями')
        throw new Error(`Отсутствуют необходимые колонки: ${missingColumns.join(', ')}`)
      }
    } else {
      console.error('ОШИБКА: Не найдено ни одной записи в CSV файле!')
      throw new Error('CSV файл пуст или не может быть распарсен')
    }

    console.log(`\nНайдено ${records.length} записей в CSV файле`)
    console.log('Загружаем список клиентов для проверки...')

    // Загружаем все клиенты в память для быстрой проверки
    const allClients = await prisma.client.findMany({
      select: { TIN: true }
    })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов для проверки\n`)

    // Загружаем все существующие записи finance для сравнения
    console.log('Загружаем существующие записи finance для сравнения...')
    const existingFinances = await prisma.finance.findMany({
      select: {
        id: true,
        branch: true,
        orderNumber: true,
        clientTIN: true,
        date: true,
      }
    })
    
    // Функция для создания уникального ключа записи
    const financeKey = (b: string, on: string, t: string, d: Date) => {
      const dateStr = d.toISOString().split('T')[0]
      return `${b}|${on}|${t}|${dateStr}`
    }
    
    // Создаем Map для быстрого поиска по ключу (branch + orderNumber + clientTIN + date)
    const existingFinancesMap = new Map<string, { id: string }>()
    existingFinances.forEach(finance => {
      const key = financeKey(finance.branch, finance.orderNumber, finance.clientTIN, finance.date)
      existingFinancesMap.set(key, { id: finance.id })
    })
    console.log(`Загружено ${existingFinancesMap.size} существующих записей finance\n`)

    // Создаем Set для отслеживания записей из CSV
    const csvFinanceKeys = new Set<string>()

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
        const rawCounterparty = record.Клиент ? cleanValue(String(record.Клиент)) : ''  // Используем "Клиент" вместо "Контрагент"
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
        const rawDate = record.ДатаПоступления ? String(record.ДатаПоступления) : ''  // Используем "ДатаПоступления" вместо "Дата"
        const rawOrderNumber = record.КодПретензии ? cleanValue(String(record.КодПретензии)) : ''  // Используем "КодПретензии" вместо "Номер заказа"
        const rawAmount = record.СуммаПретензии ? String(record.СуммаПретензии) : '0'  // Используем "СуммаПретензии" вместо "Сумма"
        const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
        const rawComment = record.Комменатарий ? cleanValue(String(record.Комменатарий)) : null  // Используем "Комменатарий" (с опечаткой из CSV)
        
        // Получаем значения новых дат используя найденные названия колонок
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
        
        // Логируем первые несколько записей с заполненными датами для отладки
        if (i < 5 && (rawCompletionDate || rawClosingDate)) {
          console.log(`Строка ${i + 2}: completionDate="${rawCompletionDate}", closingDate="${rawClosingDate}"`)
        }

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

        // Парсим дату
        const date = parseDate(rawDate)
        if (!date) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Неверный формат даты: "${rawDate}")`)
          }
          skippedRecords.push({ row: i + 2, reason: `Неверный формат даты: "${rawDate}"` })
          skipped++
          continue
        }

        // Парсим сумму
        const amount = parseDecimal(rawAmount)

        // Парсим новые даты (опционально)
        let completionDate: Date | null = null
        let closingDate: Date | null = null
        
        if (rawCompletionDate) {
          completionDate = parseDate(rawCompletionDate)
          if (!completionDate && i < 5) {
            console.log(`Предупреждение: не удалось распарсить дату завершения "${rawCompletionDate}" в строке ${i + 2}`)
          }
        }
        
        if (rawClosingDate) {
          closingDate = parseDate(rawClosingDate)
          if (!closingDate && i < 5) {
            console.log(`Предупреждение: не удалось распарсить дату закрытия "${rawClosingDate}" в строке ${i + 2}`)
          }
        }

        // Создаем ключ для поиска
        const key = financeKey(rawBranch, rawOrderNumber, clientTIN, date)
        csvFinanceKeys.add(key)

        // Проверяем, существует ли запись
        const existingFinance = existingFinancesMap.get(key)

        if (existingFinance) {
          // Запись существует - обновляем ее
          await prisma.finance.update({
            where: { id: existingFinance.id },
            data: {
              branch: rawBranch,
              counterparty: rawCounterparty || 'Не указан',
              date: date,
              orderNumber: rawOrderNumber,
              amount: amount,
              status: rawStatus,
              comment: rawComment,
              completionDate: completionDate,
              closingDate: closingDate,
            },
          })
          updated++
        } else {
          // Запись не найдена в Map - проверяем в БД на случай дубликатов
          const existingInDb = await prisma.finance.findFirst({
            where: {
              branch: rawBranch,
              orderNumber: rawOrderNumber,
              clientTIN: clientTIN,
              date: date,
            }
          })

          if (existingInDb) {
            // Запись найдена в БД - обновляем ее
            await prisma.finance.update({
              where: { id: existingInDb.id },
              data: {
                branch: rawBranch,
                counterparty: rawCounterparty || 'Не указан',
                date: date,
                orderNumber: rawOrderNumber,
                amount: amount,
                status: rawStatus,
                comment: rawComment,
                completionDate: completionDate,
                closingDate: closingDate,
              },
            })
            updated++
          } else {
            // Записи действительно нет - создаем новую
            await prisma.finance.create({
              data: {
                branch: rawBranch,
                counterparty: rawCounterparty || 'Не указан',
                date: date,
                orderNumber: rawOrderNumber,
                amount: amount,
                status: rawStatus,
                comment: rawComment,
                completionDate: completionDate,
                closingDate: closingDate,
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
    for (const [key, finance] of existingFinancesMap.entries()) {
      if (!csvFinanceKeys.has(key)) {
        await prisma.finance.delete({
          where: { id: finance.id },
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
      where: { importType: 'finance' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'finance',
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


import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

const prisma = new PrismaClient()

interface StockCsvRow {
  Склад: string                    // warehouse
  Поклажедатель: string            // не используется
  ИНН: string                      // clientTIN
  Ячейка: string                   // не используется
  Наименование: string             // nomenclature
  Артикул: string                  // article
  Код: string                      // не используется
  Колво: string                    // quantity
  Контейнер: string                // не используется
  'Дата приемки или отгрузки': string // не используется
  'Время нахождения в ячейке (в часах)': string // не используется
  Зона: string                     // не используется
  ТипЗоны: string                  // не используется
}

// Функция для очистки значения
function cleanValue(value: string): string {
  if (!value) return ''
  return value.trim().replace(/;+$/, '')
}

// Функция для парсинга количества (целое число)
function parseQuantity(value: string): number {
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
    const csvFilePath = join(process.cwd(), 'table_data', 'stock.csv')
    
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
    const records: StockCsvRow[] = parse(fileContent, {
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

    // Удаляем все существующие записи stock для полной перезаписи данных
    console.log('Удаляем существующие записи stock...')
    const deletedCount = await prisma.stock.deleteMany({})
    console.log(`Удалено ${deletedCount.count} существующих записей stock\n`)

    // Импортируем данные в базу
    let imported = 0
    let skipped = 0
    let errors = 0
    const skippedRecords: Array<{ row: number; reason: string; data?: string }> = []
    const startTime = Date.now()

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      
      try {
        // Извлекаем данные из записи
        const rawWarehouse = record.Склад ? cleanValue(String(record.Склад)) : ''
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
        const rawNomenclature = record.Наименование ? cleanValue(String(record.Наименование)) : ''
        const rawArticle = record.Артикул ? cleanValue(String(record.Артикул)) : ''
        const rawQuantity = record.Колво ? String(record.Колво) : '0'

        // Проверяем обязательные поля
        if (!rawWarehouse) {
          const reason = 'Отсутствует склад'
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason })
          skipped++
          continue
        }

        if (!rawClientTIN) {
          const reason = 'Отсутствует ИНН клиента'
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason })
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
          skippedRecords.push({ row: i + 2, reason, data: `${rawClientTIN}; ${rawNomenclature}` })
          skipped++
          continue
        }

        // Проверяем, существует ли клиент с таким TIN (быстрая проверка в памяти)
        if (!clientTINsSet.has(clientTIN)) {
          const reason = `Клиент с ИНН ${clientTIN} не найден в базе данных`
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason, data: `${clientTIN}; ${rawNomenclature}` })
          skipped++
          continue
        }

        if (!rawNomenclature) {
          const reason = 'Отсутствует наименование'
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason })
          skipped++
          continue
        }

        if (!rawArticle) {
          const reason = 'Отсутствует артикул'
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason })
          skipped++
          continue
        }

        // Парсим количество
        const quantity = parseQuantity(rawQuantity)
        
        if (quantity < 0) {
          const reason = `Некорректное количество: ${quantity}`
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (${reason})`)
          }
          skippedRecords.push({ row: i + 2, reason, data: `${rawArticle}; ${rawNomenclature}` })
          skipped++
          continue
        }

        // Создаем запись Stock
        await prisma.stock.create({
          data: {
            warehouse: rawWarehouse,
            nomenclature: rawNomenclature,
            article: rawArticle,
            quantity: quantity,
            clientTIN: clientTIN,
            // createdAt и updatedAt будут созданы автоматически
          },
        })

        // Показываем прогресс каждые 1000 записей
        if ((i + 1) % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          const rate = ((i + 1) / (Date.now() - startTime)) * 1000
          const remaining = Math.round((records.length - i - 1) / rate)
          console.log(`Обработано ${i + 1}/${records.length} записей (${((i + 1) / records.length * 100).toFixed(1)}%) | Импортировано: ${imported} | Скорость: ${rate.toFixed(0)} зап/сек | Осталось: ~${remaining} сек`)
        }

        imported++
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

    console.log('\n=== Результаты импорта ===')
    console.log(`Импортировано: ${imported}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    
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


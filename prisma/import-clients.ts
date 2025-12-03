import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

const prisma = new PrismaClient()

// Функция для конвертации научной нотации в обычное число
function convertScientificNotation(value: string): string {
  if (!value) return ''
  
  // Убираем пробелы
  value = value.trim()
  
  // Если значение содержит 'E' или 'e', это научная нотация
  if (/[Ee]/.test(value)) {
    // Заменяем запятую на точку для парсинга
    const normalized = value.replace(',', '.')
    const num = parseFloat(normalized)
    
    if (isNaN(num)) {
      return value // Если не удалось распарсить, возвращаем как есть
    }
    
    // Убираем дробную часть, если это целое число
    return Math.round(num).toString()
  }
  
  // Убираем запятые (если есть)
  return value.replace(/,/g, '')
}

// Функция для очистки названия компании от лишних кавычек
function cleanCompanyName(name: string): string {
  if (!name) return ''
  // Убираем внешние кавычки, если они есть
  let cleaned = name.trim()
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
      (cleaned.startsWith('«') && cleaned.endsWith('»'))) {
    cleaned = cleaned.slice(1, -1)
  }
  // Заменяем двойные кавычки на одинарные
  cleaned = cleaned.replace(/""/g, '"')
  // Убираем точку с запятой в конце, если есть
  cleaned = cleaned.replace(/;+$/, '')
  return cleaned.trim()
}

async function main() {
  try {
    // Читаем CSV файл с правильной кодировкой
    // Используем process.cwd() чтобы путь всегда указывал на корень проекта
    const csvFilePath = join(process.cwd(), 'table_data', 'clients.csv')
    
    // Пробуем прочитать файл в разных кодировках
    let fileContent: string
    const buffer = readFileSync(csvFilePath)
    
    // Пробуем сначала Windows-1251 (обычно для русских CSV файлов из Excel)
    try {
      fileContent = iconv.decode(buffer, 'win1251')
      // Проверяем, что декодирование прошло успешно (есть читаемые символы)
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
    const records: string[][] = parse(fileContent, {
      delimiter: ';',
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Разрешаем разное количество колонок
    })

    console.log(`Найдено ${records.length} записей в CSV файле`)

    // Импортируем данные в базу
    let imported = 0
    let skipped = 0
    let errors = 0
    const skippedRecords: Array<{ row: number; reason: string; data?: string }> = []

    for (let i = 0; i < records.length; i++) {
      const row = records[i]
      
      try {
        // Пропускаем пустые строки
        if (!row || row.length < 2) {
          const reason = 'Недостаточно данных (меньше 2 колонок)'
          console.log(`Строка ${i + 1}: пропущена (${reason})`)
          skippedRecords.push({ row: i + 1, reason, data: row.join(';') })
          skipped++
          continue
        }

        const rawTIN = row[0]?.trim() || ''
        const rawCompanyName = row[1]?.trim() || ''

        // Пропускаем, если нет TIN или названия
        if (!rawTIN || !rawCompanyName) {
          const reason = 'Пустые данные (нет TIN или названия компании)'
          console.log(`Строка ${i + 1}: пропущена (${reason})`)
          skippedRecords.push({ row: i + 1, reason, data: `${rawTIN || 'пусто'}; ${rawCompanyName || 'пусто'}` })
          skipped++
          continue
        }

        // Конвертируем TIN
        const TIN = convertScientificNotation(rawTIN)
        
        // Очищаем название компании
        const companyName = cleanCompanyName(rawCompanyName)

        // Извлекаем только цифры из TIN (на случай если есть лишний текст)
        const tinOnlyNumbers = TIN.replace(/\D/g, '')
        
        // Валидация TIN (должен быть числом)
        if (!tinOnlyNumbers || tinOnlyNumbers.length === 0) {
          const reason = `Неверный формат TIN: "${TIN}" (нет цифр)`
          console.log(`Строка ${i + 1}: пропущена (${reason})`)
          skippedRecords.push({ row: i + 1, reason, data: `${rawTIN}; ${rawCompanyName}` })
          skipped++
          continue
        }
        
        const finalTIN = tinOnlyNumbers

        // Проверяем, существует ли клиент с таким TIN
        const existing = await prisma.client.findUnique({
          where: { TIN: finalTIN },
        })

        if (existing) {
          const reason = `Клиент с TIN ${finalTIN} уже существует в базе данных`
          console.log(`Строка ${i + 1}: ${reason}`)
          skippedRecords.push({ row: i + 1, reason, data: `${rawTIN}; ${rawCompanyName}` })
          skipped++
          continue
        }

        // Создаем клиента (Prisma автоматически создаст ID и даты)
        await prisma.client.create({
          data: {
            TIN: finalTIN,
            companyName: companyName,
            // createdAt и updatedAt будут созданы автоматически
          },
        })

        console.log(`Строка ${i + 1}: импортирован клиент "${companyName}" (TIN: ${finalTIN})`)
        imported++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`Строка ${i + 1}: ошибка при импорте:`, errorMessage)
        skippedRecords.push({ 
          row: i + 1, 
          reason: `Ошибка: ${errorMessage}`, 
          data: row.join(';') 
        })
        errors++
      }
    }

    console.log('\n=== Результаты импорта ===')
    console.log(`Импортировано: ${imported}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    
    // Детальный отчет о пропущенных записях
    if (skippedRecords.length > 0) {
      console.log('\n=== Детализация пропущенных записей ===')
      skippedRecords.forEach(({ row, reason, data }) => {
        console.log(`\nСтрока ${row}:`)
        console.log(`  Причина: ${reason}`)
        if (data) {
          console.log(`  Данные: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`)
        }
      })
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

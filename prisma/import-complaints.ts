import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'

const prisma = new PrismaClient()

interface ComplaintCsvRow {
  Филиал: string
  Клиент: string
  ИНН: string
  ДатаСоздания: string
  НомерРекламации: string
  ТипПретензии: string
  Статус: string
  Подтверждение: string
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

// Функция для парсинга boolean из строки (0 или 1)
function parseBoolean(value: string): boolean {
  if (!value) return false
  const cleaned = value.trim()
  return cleaned === '1' || cleaned.toLowerCase() === 'true'
}

async function main() {
  try {
    // Читаем CSV файл с правильной кодировкой
    const csvFilePath = join(process.cwd(), 'table_data', 'complaints.csv')
    
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
    const records: ComplaintCsvRow[] = parse(fileContent, {
      delimiter: ';',
      columns: true, // Используем первую строку как заголовки
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Разрешаем разное количество колонок
    })

    // Отладочный вывод: показываем названия колонок из первой записи
    if (records.length > 0) {
      const columnNames = Object.keys(records[0])
      console.log('\nНайденные колонки в CSV:', columnNames)
      console.log('Пример первой записи:', JSON.stringify(records[0], null, 2))
      
      // Проверяем, что все необходимые колонки присутствуют
      const requiredColumns = ['Филиал', 'Клиент', 'ИНН', 'ДатаСоздания', 'НомерРекламации', 'ТипПретензии', 'Статус', 'Подтверждение']
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
      
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

    // Загружаем все существующие записи complaints для сравнения
    console.log('Загружаем существующие записи complaints для сравнения...')
    const existingComplaints = await prisma.complaint.findMany({
      select: {
        id: true,
        branch: true,
        complaintNumber: true,
        clientTIN: true,
        creationDate: true,
      }
    })
    
    // Функция для создания уникального ключа записи
    const complaintKey = (b: string, cn: string, t: string, d: Date) => {
      const dateStr = d.toISOString().split('T')[0]
      return `${b}|${cn}|${t}|${dateStr}`
    }
    
    // Создаем Map для быстрого поиска по ключу (branch + complaintNumber + clientTIN + creationDate)
    const existingComplaintsMap = new Map<string, { id: string }>()
    existingComplaints.forEach(complaint => {
      const key = complaintKey(complaint.branch, complaint.complaintNumber, complaint.clientTIN, complaint.creationDate)
      existingComplaintsMap.set(key, { id: complaint.id })
    })
    console.log(`Загружено ${existingComplaintsMap.size} существующих записей complaints\n`)

    // Создаем Set для отслеживания записей из CSV
    const csvComplaintKeys = new Set<string>()

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
        const rawClient = record.Клиент ? cleanValue(String(record.Клиент)) : ''
        const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
        const rawCreationDate = record.ДатаСоздания ? String(record.ДатаСоздания) : ''
        const rawComplaintNumber = record.НомерРекламации ? cleanValue(String(record.НомерРекламации)) : ''
        const rawComplaintType = record.ТипПретензии ? cleanValue(String(record.ТипПретензии)) : ''
        const rawStatus = record.Статус ? cleanValue(String(record.Статус)) : ''
        const rawConfirmation = record.Подтверждение ? String(record.Подтверждение) : '0'

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
          skippedRecords.push({ row: i + 2, reason, data: `${clientTIN}; ${rawClient}` })
          skipped++
          continue
        }

        if (!rawComplaintNumber) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Отсутствует номер рекламации)`)
          }
          skippedRecords.push({ row: i + 2, reason: 'Отсутствует номер рекламации' })
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
        const creationDate = parseDate(rawCreationDate)
        if (!creationDate) {
          if (i < 10 || skippedRecords.length < 10) {
            console.log(`Строка ${i + 2}: пропущена (Неверный формат даты: "${rawCreationDate}")`)
          }
          skippedRecords.push({ row: i + 2, reason: `Неверный формат даты: "${rawCreationDate}"` })
          skipped++
          continue
        }

        // Парсим подтверждение
        const confirmation = parseBoolean(rawConfirmation)

        // Создаем ключ для поиска
        const key = complaintKey(rawBranch, rawComplaintNumber, clientTIN, creationDate)
        csvComplaintKeys.add(key)

        // Проверяем, существует ли запись
        const existingComplaint = existingComplaintsMap.get(key)

        if (existingComplaint) {
          // Запись существует - обновляем ее
          await prisma.complaint.update({
            where: { id: existingComplaint.id },
            data: {
              branch: rawBranch,
              client: rawClient || 'Не указан',
              creationDate: creationDate,
              complaintNumber: rawComplaintNumber,
              complaintType: rawComplaintType || 'Не указан',
              status: rawStatus,
              confirmation: confirmation,
            },
          })
          updated++
        } else {
          // Запись не найдена в Map - проверяем в БД на случай дубликатов
          const existingInDb = await prisma.complaint.findFirst({
            where: {
              branch: rawBranch,
              complaintNumber: rawComplaintNumber,
              clientTIN: clientTIN,
              creationDate: creationDate,
            }
          })

          if (existingInDb) {
            // Запись найдена в БД - обновляем ее
            await prisma.complaint.update({
              where: { id: existingInDb.id },
              data: {
                branch: rawBranch,
                client: rawClient || 'Не указан',
                creationDate: creationDate,
                complaintNumber: rawComplaintNumber,
                complaintType: rawComplaintType || 'Не указан',
                status: rawStatus,
                confirmation: confirmation,
              },
            })
            updated++
          } else {
            // Записи действительно нет - создаем новую
            await prisma.complaint.create({
              data: {
                branch: rawBranch,
                client: rawClient || 'Не указан',
                creationDate: creationDate,
                complaintNumber: rawComplaintNumber,
                complaintType: rawComplaintType || 'Не указан',
                status: rawStatus,
                confirmation: confirmation,
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
    for (const [key, complaint] of existingComplaintsMap.entries()) {
      if (!csvComplaintKeys.has(key)) {
        await prisma.complaint.delete({
          where: { id: complaint.id },
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
      where: { importType: 'complaints' },
      update: {
        lastImportAt: importTime,
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'complaints',
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


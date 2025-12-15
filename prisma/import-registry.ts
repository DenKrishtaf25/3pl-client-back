import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

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

const registryKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`

async function main() {
  try {
    const csvFilePath = join(process.cwd(), 'table_data', 'registry.csv')
    console.log('Начинаем потоковый импорт registry...')

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(allClients.map(c => c.TIN))
    console.log(`Загружено ${clientTINsSet.size} клиентов`)

    const existingRegistriesMap = new Map<string, { id: string }>()
    let skip = 0
    const batchSize = 10000
    
    while (true) {
      const batch = await prisma.registry.findMany({
        select: { id: true, branch: true, orderType: true, orderNumber: true, clientTIN: true },
        skip,
        take: batchSize,
      })
      if (batch.length === 0) break
      
      batch.forEach(registry => {
        const key = registryKey(registry.branch, registry.orderType, registry.orderNumber, registry.clientTIN)
        existingRegistriesMap.set(key, { id: registry.id })
      })
      
      skip += batchSize
      if (batch.length < batchSize) break
    }
    
    console.log(`Загружено ${existingRegistriesMap.size} существующих записей registry`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvRegistryKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 500
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        await prisma.registry.createMany({ data: createBatch, skipDuplicates: true })
        imported += createBatch.length
        createBatch.length = 0
      }

      for (const update of updateBatch) {
        try {
          await prisma.registry.update({ where: { id: update.id }, data: update.data })
          updated++
        } catch (error) {
          errors++
        }
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
            if (chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
              chunk = chunk.slice(3)
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
    const parser = parse({
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })

    const processStream = new Transform({
      objectMode: true,
      async transform(record: RegistryCsvRow, encoding, callback) {
        rowNumber++
        
        try {
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)) : ''
          const rawCounterparty = record.Контрагент ? cleanValue(String(record.Контрагент)) : ''
          const rawClientTIN = record.ИНН ? cleanValue(String(record.ИНН)) : ''
          const rawVehicleNumber = record['Номер ТС'] ? cleanValue(String(record['Номер ТС'])) : ''
          const rawOrderType = record['Тип прихода'] ? cleanValue(String(record['Тип прихода'])) : ''
          const rawOrderNumber = record['Номер заказа или маршрутного листа'] ? cleanValue(String(record['Номер заказа или маршрутного листа'])) : ''
          const rawDriverName = record['ФИО водителя'] ? cleanValue(String(record['ФИО водителя'])) : ''
          const rawProcessingType = record['Тип Обработки'] ? cleanValue(String(record['Тип Обработки'])) : ''
          const rawKisNumber = ''
          const rawUnloadingDate = record['Дата фактического прибытия ТС'] ? String(record['Дата фактического прибытия ТС']) : ''
          const rawStatus = record['Статус ТС'] ? cleanValue(String(record['Статус ТС'])) : ''
          const rawAcceptanceDate = record['Дата прибытия ТС по заявке'] ? String(record['Дата прибытия ТС по заявке']) : ''
          const rawShipmentPlan = record['Дата планового прибытия ТС'] ? String(record['Дата планового прибытия ТС']) : ''
          const rawDepartureDate = record['Дата убытия ТС'] ? String(record['Дата убытия ТС']) : ''

          if (!rawBranch || !rawClientTIN || !rawOrderType || !rawOrderNumber || !rawStatus) {
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

          const unloadingDate = parseDate(rawUnloadingDate) || new Date()
          const acceptanceDate = parseDate(rawAcceptanceDate) || new Date()
          const shipmentPlan = parseDate(rawShipmentPlan) || new Date()
          const departureDate = parseDate(rawDepartureDate)

          const key = registryKey(rawBranch, rawOrderType, rawOrderNumber, clientTIN)
          csvRegistryKeys.add(key)

          const existingRegistry = existingRegistriesMap.get(key)

          if (existingRegistry) {
            updateBatch.push({
              id: existingRegistry.id,
              data: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber,
                unloadingDate,
                status: rawStatus,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate,
                shipmentPlan,
                packagesPlanned: 0,
                packagesActual: 0,
                linesPlanned: 0,
                linesActual: 0,
                vehicleNumber: rawVehicleNumber || null,
                driverName: rawDriverName || null,
                processingType: rawProcessingType || null,
                departureDate,
              }
            })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            const existingInDb = await prisma.registry.findFirst({
              where: { branch: rawBranch, orderType: rawOrderType, orderNumber: rawOrderNumber, clientTIN }
            })

            if (existingInDb) {
              updateBatch.push({
                id: existingInDb.id,
                data: {
                  branch: rawBranch,
                  orderType: rawOrderType,
                  orderNumber: rawOrderNumber,
                  kisNumber: rawKisNumber,
                  unloadingDate,
                  status: rawStatus,
                  counterparty: rawCounterparty || 'Не указан',
                  acceptanceDate,
                  shipmentPlan,
                  packagesPlanned: 0,
                  packagesActual: 0,
                  linesPlanned: 0,
                  linesActual: 0,
                  vehicleNumber: rawVehicleNumber || null,
                  driverName: rawDriverName || null,
                  processingType: rawProcessingType || null,
                  departureDate,
                }
              })
              if (updateBatch.length >= BATCH_SIZE) await processBatches()
            } else {
              createBatch.push({
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                kisNumber: rawKisNumber,
                unloadingDate,
                status: rawStatus,
                counterparty: rawCounterparty || 'Не указан',
                acceptanceDate,
                shipmentPlan,
                packagesPlanned: 0,
                packagesActual: 0,
                linesPlanned: 0,
                linesActual: 0,
                vehicleNumber: rawVehicleNumber || null,
                driverName: rawDriverName || null,
                processingType: rawProcessingType || null,
                departureDate,
                clientTIN,
              })
              if (createBatch.length >= BATCH_SIZE) await processBatches()
            }
          }

          if (rowNumber % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(`Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Скорость: ${rate.toFixed(0)} зап/сек`)
          }
        } catch (error) {
          errors++
          skippedRecords.push({ row: rowNumber, reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}` })
        }
        callback()
      },
    })

    await pipeline(readStream, decodeStream, parser, processStream)
    await processBatches()

    console.log('\nУдаляем записи, отсутствующие в CSV...')
    let deleted = 0
    const deleteBatch: string[] = []
    
    for (const [key, registry] of existingRegistriesMap.entries()) {
      if (!csvRegistryKeys.has(key)) {
        deleteBatch.push(registry.id)
        if (deleteBatch.length >= BATCH_SIZE) {
          await prisma.registry.deleteMany({ where: { id: { in: deleteBatch } } })
          deleted += deleteBatch.length
          deleteBatch.length = 0
        }
      }
    }
    
    if (deleteBatch.length > 0) {
      await prisma.registry.deleteMany({ where: { id: { in: deleteBatch } } })
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
      where: { importType: 'registry' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'registry',
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


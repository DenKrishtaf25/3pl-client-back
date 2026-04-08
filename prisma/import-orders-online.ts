import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

const prisma = new PrismaClient()

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

function normalizeTin(value: string): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null
  const cleaned = dateStr.trim()

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = isoMatch
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`)
    return !isNaN(date.getTime()) ? date : null
  }

  const dateMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (dateMatch) {
    const [, day, month, year, hour = '0', minute = '0'] = dateMatch
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`)
    return !isNaN(date.getTime()) ? date : null
  }

  return null
}

function parseInteger(value: string): number {
  if (!value) return 0
  const cleaned = value.trim().replace(/,/g, '').replace(/\s/g, '').replace(/\./g, '')
  let num = parseInt(cleaned, 10)
  if (isNaN(num)) {
    const floatNum = parseFloat(cleaned)
    num = isNaN(floatNum) ? 0 : Math.round(floatNum)
  }
  const MAX_INT = 2147483647
  const MIN_INT = -2147483648
  if (num > MAX_INT) {
    console.warn(`Значение ${num} (из "${value}") превышает MAX_INT, обрезано до ${MAX_INT}`)
    return MAX_INT
  }
  if (num < MIN_INT) {
    console.warn(`Значение ${num} (из "${value}") меньше MIN_INT, обрезано до ${MIN_INT}`)
    return MIN_INT
  }
  return num
}

function parseDecimal(value: string): number {
  if (!value) return 0
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  const num = Number.parseFloat(normalized)
  if (Number.isNaN(num)) return 0
  return Number(num.toFixed(2))
}

const orderKey = (b: string, ot: string, on: string, t: string) => `${b}|${ot}|${on}|${t}`

function orderUpdateData(
  rawBranch: string,
  rawOrderType: string,
  rawOrderNumber: string,
  rawKisNumber: string,
  exportDate: Date,
  shipmentDate: Date | null,
  rawStatus: string,
  packagesPlanned: number,
  packagesActual: number,
  linesPlanned: number,
  linesActual: number,
  rawCounterparty: string,
  acceptanceDate: Date | null,
) {
  return {
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
  }
}

async function main() {
  try {
    const csvFilePath = join(process.cwd(), 'table_data', 'orders', 'orders_online.csv')
    console.log(
      'Импорт всего orders_online.csv (без отсечения по датам в скрипте — состав файла задаёт источник)...',
    )

    const allClients = await prisma.client.findMany({ select: { TIN: true } })
    const clientTINsSet = new Set(
      allClients.map(c => normalizeTin((c.TIN || '').trim())).filter(Boolean),
    )
    const normalizedTinToDbTin = new Map<string, string>()
    for (const c of allClients) {
      const n = normalizeTin((c.TIN || '').trim())
      if (n && !normalizedTinToDbTin.has(n)) {
        normalizedTinToDbTin.set(n, (c.TIN || '').trim())
      }
    }
    console.log(`Загружено ${clientTINsSet.size} уникальных ИНН клиентов (после нормализации)`)

    const existingOrdersMap = new Map<string, { id: string }>()
    let skip = 0
    const mapPageSize = 5000

    console.log('Загружаем все существующие записи order в память для сопоставления ключей...')

    while (true) {
      const batch = await prisma.order.findMany({
        select: { id: true, branch: true, orderType: true, orderNumber: true, clientTIN: true },
        skip,
        take: mapPageSize,
      })
      if (batch.length === 0) break

      batch.forEach(order => {
        const normalizedBranch = order.branch.trim()
        const normalizedOrderType = order.orderType.trim()
        const normalizedOrderNumber = order.orderNumber.trim()
        const normalizedClientTIN = normalizeTin(order.clientTIN.trim())
        const key = orderKey(normalizedBranch, normalizedOrderType, normalizedOrderNumber, normalizedClientTIN)
        existingOrdersMap.set(key, { id: order.id })
      })

      skip += mapPageSize
      if (batch.length < mapPageSize) break
      await new Promise(resolve => setImmediate(resolve))
    }

    console.log(`Загружено ${existingOrdersMap.size} существующих записей orders в карту`)

    let imported = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    let rowNumber = 1
    const skippedRecords: Array<{ row: number; reason: string }> = []
    const csvSeenKeys = new Set<string>()
    const startTime = Date.now()

    const BATCH_SIZE = 100
    const createBatch: Array<any> = []
    const updateBatch: Array<{ id: string; data: any }> = []

    async function processBatches() {
      if (createBatch.length > 0) {
        await prisma.order.createMany({ data: createBatch, skipDuplicates: true })
        imported += createBatch.length
        createBatch.length = 0
      }

      for (const update of updateBatch) {
        try {
          await prisma.order.update({ where: { id: update.id }, data: update.data })
          updated++
        } catch {
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
            if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
              chunk = chunk.slice(3)
            }
          }
          this.push(chunk.toString('utf-8'))
          callback()
        } catch (error) {
          callback(error as Error)
        }
      },
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
      async transform(record: OrderCsvRow, encoding, callback) {
        rowNumber++

        try {
          const rawBranch = record.Филиал ? cleanValue(String(record.Филиал)).trim() : ''
          const rawOrderType = record['Тип заказа'] ? cleanValue(String(record['Тип заказа'])).trim() : ''
          const rawOrderNumber = record['Номер заказа'] ? cleanValue(String(record['Номер заказа'])).trim() : ''
          const rawKisNumber = record['Номер заказа КИС'] ? cleanValue(String(record['Номер заказа КИС'])).trim() : ''
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
            skippedRecords.push({ row: rowNumber, reason: 'Отсутствуют обязательные поля' })
            skipped++
            return callback()
          }

          const clientTINNorm = normalizeTin(rawClientTIN)
          if (!clientTINNorm || !clientTINsSet.has(clientTINNorm)) {
            skippedRecords.push({ row: rowNumber, reason: `Клиент с ИНН ${clientTINNorm} не найден` })
            skipped++
            return callback()
          }
          const clientTIN = normalizedTinToDbTin.get(clientTINNorm) || clientTINNorm

          const exportDate = parseDate(rawExportDate) || new Date()
          const shipmentDate = parseDate(rawShipmentDate)
          const acceptanceDate = parseDate(rawAcceptanceDate)

          const packagesPlanned = parseDecimal(rawPackagesPlanned)
          const packagesActual = parseDecimal(rawPackagesActual)
          const linesPlanned = parseInteger(rawLinesPlanned)
          const linesActual = parseInteger(rawLinesActual)

          const key = orderKey(rawBranch, rawOrderType, rawOrderNumber, clientTINNorm)

          if (csvSeenKeys.has(key)) {
            skipped++
            return callback()
          }
          csvSeenKeys.add(key)

          const data = orderUpdateData(
            rawBranch,
            rawOrderType,
            rawOrderNumber,
            rawKisNumber,
            exportDate,
            shipmentDate,
            rawStatus,
            packagesPlanned,
            packagesActual,
            linesPlanned,
            linesActual,
            rawCounterparty,
            acceptanceDate,
          )

          const existingOrder = existingOrdersMap.get(key)

          if (existingOrder) {
            updateBatch.push({ id: existingOrder.id, data })
            if (updateBatch.length >= BATCH_SIZE) await processBatches()
          } else {
            const existingInDb = await prisma.order.findFirst({
              where: {
                branch: rawBranch,
                orderType: rawOrderType,
                orderNumber: rawOrderNumber,
                clientTIN,
              },
              select: { id: true },
            })

            if (existingInDb) {
              existingOrdersMap.set(key, { id: existingInDb.id })
              updateBatch.push({ id: existingInDb.id, data })
              if (updateBatch.length >= BATCH_SIZE) await processBatches()
            } else {
              createBatch.push({
                ...data,
                clientTIN,
              })
              if (createBatch.length >= BATCH_SIZE) await processBatches()
            }
          }

          if (rowNumber % 1000 === 0) {
            const rate = (rowNumber / (Date.now() - startTime)) * 1000
            console.log(
              `Обработано ${rowNumber} записей | Импортировано: ${imported} | Обновлено: ${updated} | Пропущено: ${skipped} | Скорость: ${rate.toFixed(0)} зап/сек`,
            )
          }
        } catch (error) {
          errors++
          skippedRecords.push({
            row: rowNumber,
            reason: `Ошибка: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
        callback()
      },
    })

    await pipeline(readStream, decodeStream, parser, processStream)
    await processBatches()

    const deleted = 0

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('\n=== Результаты импорта orders_online.csv ===')
    console.log(`Создано новых: ${imported}`)
    console.log(`Обновлено: ${updated}`)
    console.log(`Удалено: ${deleted}`)
    console.log(`Пропущено: ${skipped}`)
    console.log(`Ошибок: ${errors}`)
    console.log(`Время выполнения: ${totalDuration} сек`)

    await prisma.importMetadata.upsert({
      where: { importType: 'orders_online' },
      update: {
        lastImportAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated,
        recordsDeleted: deleted,
        recordsSkipped: skipped,
        errors: errors,
      },
      create: {
        importType: 'orders_online',
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
  .catch(async e => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

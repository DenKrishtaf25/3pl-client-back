import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixDuplicateDates() {
  try {
    console.log('Исправление записей с одинаковыми датами импорта...\n')

    // Дата другого импорта - все записи с этой датой или близкой к ней
    const importDateStart = new Date('2025-12-08T15:39:00.000Z')
    const importDateEnd = new Date('2025-12-08T15:40:00.000Z')

    // Находим все записи где shipmentDate и acceptanceDate одинаковые и в диапазоне импорта
    const ordersToFix = await prisma.order.findMany({
      where: {
        AND: [
          {
            shipmentDate: {
              gte: importDateStart,
              lte: importDateEnd,
            }
          },
          {
            acceptanceDate: {
              gte: importDateStart,
              lte: importDateEnd,
            }
          }
        ]
      },
      select: {
        id: true,
        orderNumber: true,
        shipmentDate: true,
        acceptanceDate: true,
      }
    })

    console.log(`Найдено записей с одинаковыми датами импорта: ${ordersToFix.length}`)
    
    if (ordersToFix.length === 0) {
      console.log('Нет записей для исправления.')
      return
    }

    console.log('\nПримеры первых 5 записей:')
    ordersToFix.slice(0, 5).forEach(order => {
      console.log(`  ${order.orderNumber}: shipmentDate=${order.shipmentDate?.toISOString()}, acceptanceDate=${order.acceptanceDate?.toISOString()}`)
    })

    // Устанавливаем NULL для этих дат, так как они были пустыми в CSV
    let fixed = 0
    for (const order of ordersToFix) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          shipmentDate: null,
          acceptanceDate: null,
        },
      })
      fixed++
      
      if (fixed % 1000 === 0) {
        console.log(`Обработано ${fixed} записей...`)
      }
    }

    console.log(`\n=== Результаты ===`)
    console.log(`Исправлено записей: ${fixed}`)

  } catch (error) {
    console.error('Ошибка:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixDuplicateDates()


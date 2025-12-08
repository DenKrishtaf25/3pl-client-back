import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixOrderDates() {
  try {
    console.log('Исправление неправильных дат в таблице order...\n')

    // Дата импорта, которая использовалась как значение по умолчанию
    // Все записи с этой датой или близкой к ней нужно проверить
    const importDateStart = new Date('2025-12-08T15:24:00.000Z')
    const importDateEnd = new Date('2025-12-08T15:25:00.000Z')

    // Найдем все записи с shipmentDate в этом диапазоне
    const ordersWithBadShipmentDate = await prisma.order.findMany({
      where: {
        shipmentDate: {
          gte: importDateStart,
          lte: importDateEnd,
        }
      },
      select: {
        id: true,
        orderNumber: true,
        shipmentDate: true,
        acceptanceDate: true,
      },
      take: 100, // Для проверки сначала
    })

    console.log(`Найдено записей с подозрительной shipmentDate: ${ordersWithBadShipmentDate.length}`)
    
    if (ordersWithBadShipmentDate.length > 0) {
      console.log('\nПримеры первых 5 записей:')
      ordersWithBadShipmentDate.slice(0, 5).forEach(order => {
        console.log(`  ${order.orderNumber}: shipmentDate=${order.shipmentDate?.toISOString()}, acceptanceDate=${order.acceptanceDate?.toISOString()}`)
      })
    }

    // Получаем полный список для обновления
    const allOrdersWithBadDates = await prisma.order.findMany({
      where: {
        OR: [
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
        shipmentDate: true,
        acceptanceDate: true,
      }
    })

    console.log(`\nВсего записей для исправления: ${allOrdersWithBadDates.length}`)

    // Обновляем записи
    let fixedShipment = 0
    let fixedAcceptance = 0

    for (const order of allOrdersWithBadDates) {
      const updateData: {
        shipmentDate?: null
        acceptanceDate?: null
      } = {}

      // Проверяем shipmentDate
      if (order.shipmentDate) {
        const sd = new Date(order.shipmentDate)
        if (sd >= importDateStart && sd <= importDateEnd) {
          updateData.shipmentDate = null
          fixedShipment++
        }
      }

      // Проверяем acceptanceDate
      if (order.acceptanceDate) {
        const ad = new Date(order.acceptanceDate)
        if (ad >= importDateStart && ad <= importDateEnd) {
          updateData.acceptanceDate = null
          fixedAcceptance++
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.order.update({
          where: { id: order.id },
          data: updateData,
        })
      }
    }

    console.log(`\n=== Результаты исправления ===`)
    console.log(`Исправлено shipmentDate: ${fixedShipment}`)
    console.log(`Исправлено acceptanceDate: ${fixedAcceptance}`)
    console.log(`Всего обновлено записей: ${allOrdersWithBadDates.length}`)

  } catch (error) {
    console.error('Ошибка:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixOrderDates()


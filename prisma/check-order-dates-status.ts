import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkStatus() {
  try {
    const total = await prisma.order.count()
    
    const withNullShipment = await prisma.order.count({
      where: { shipmentDate: null }
    })
    
    const withNullAcceptance = await prisma.order.count({
      where: { acceptanceDate: null }
    })

    // Проверяем записи с одинаковыми датами (потенциальная проблема)
    const sampleOrders = await prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        orderNumber: true,
        exportDate: true,
        shipmentDate: true,
        acceptanceDate: true,
      }
    })

    console.log('=== Статистика по датам в таблице order ===\n')
    console.log(`Всего записей: ${total}`)
    console.log(`Записей с NULL shipmentDate: ${withNullShipment} (${(withNullShipment/total*100).toFixed(1)}%)`)
    console.log(`Записей с NULL acceptanceDate: ${withNullAcceptance} (${(withNullAcceptance/total*100).toFixed(1)}%)`)
    
    console.log('\n=== Примеры последних 10 записей ===\n')
    sampleOrders.forEach((order, i) => {
      console.log(`${i+1}. Заказ ${order.orderNumber}:`)
      console.log(`   exportDate:      ${order.exportDate?.toISOString() || 'null'}`)
      console.log(`   shipmentDate:    ${order.shipmentDate?.toISOString() || 'null'}`)
      console.log(`   acceptanceDate:  ${order.acceptanceDate?.toISOString() || 'null'}`)
      console.log('')
    })

    // Проверяем записи где shipmentDate == acceptanceDate (возможная проблема)
    const withSameDates = await prisma.order.count({
      where: {
        AND: [
          { shipmentDate: { not: null } },
          { acceptanceDate: { not: null } },
        ],
      },
    })

    const withSameDatesSQL = await prisma.$queryRaw<Array<{count: bigint}>>`
      SELECT COUNT(*) as count
      FROM "order"
      WHERE shipment_date IS NOT NULL 
        AND acceptance_date IS NOT NULL
        AND shipment_date = acceptance_date
    `

    console.log(`Записей где shipmentDate == acceptanceDate: ${withSameDatesSQL[0].count}`)

  } catch (error) {
    console.error('Ошибка:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkStatus()


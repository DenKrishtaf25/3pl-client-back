import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkStatus() {
  try {
    const totalSave = await prisma.orderSave.count()
    const totalOnline = await prisma.orderOnline.count()
    const total = totalSave + totalOnline

    const withNullShipment =
      (await prisma.orderSave.count({ where: { shipmentDate: null } })) +
      (await prisma.orderOnline.count({ where: { shipmentDate: null } }))

    const withNullAcceptance =
      (await prisma.orderSave.count({ where: { acceptanceDate: null } })) +
      (await prisma.orderOnline.count({ where: { acceptanceDate: null } }))

    const sampleOrders = await prisma.orderOnline.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        orderNumber: true,
        exportDate: true,
        shipmentDate: true,
        acceptanceDate: true,
      },
    })

    console.log('=== Статистика по датам (orders_save + orders_online) ===\n')
    console.log(`Всего записей: ${total} (orders_save: ${totalSave}, orders_online: ${totalOnline})`)
    if (total > 0) {
      console.log(`Записей с NULL shipmentDate: ${withNullShipment} (${((withNullShipment / total) * 100).toFixed(1)}%)`)
      console.log(`Записей с NULL acceptanceDate: ${withNullAcceptance} (${((withNullAcceptance / total) * 100).toFixed(1)}%)`)
    }

    console.log('\n=== Примеры последних 10 записей (orders_online) ===\n')
    sampleOrders.forEach((order, i) => {
      console.log(`${i + 1}. Заказ ${order.orderNumber}:`)
      console.log(`   exportDate:      ${order.exportDate?.toISOString() || 'null'}`)
      console.log(`   shipmentDate:    ${order.shipmentDate?.toISOString() || 'null'}`)
      console.log(`   acceptanceDate:  ${order.acceptanceDate?.toISOString() || 'null'}`)
      console.log('')
    })

    const withSameDatesSQL = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM (
        SELECT shipment_date, acceptance_date FROM "orders_save"
        UNION ALL
        SELECT shipment_date, acceptance_date FROM "orders_online"
      ) t
      WHERE shipment_date IS NOT NULL
        AND acceptance_date IS NOT NULL
        AND shipment_date = acceptance_date
    `

    console.log(`Записей где shipmentDate == acceptanceDate (обе таблицы): ${withSameDatesSQL[0].count}`)
  } catch (error) {
    console.error('Ошибка:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkStatus()

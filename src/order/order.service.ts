import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { OrderDto, UpdateOrderDto, FindOrderDto } from './order.dto'
import { Prisma } from '@prisma/client'

type UnifiedOrderRow = {
  id: string
  created_at: Date
  updated_at: Date
  branch: string
  order_type: string
  order_number: string
  kis_number: string
  export_date: Date
  shipment_date: Date | null
  status: string
  packages_planned: number
  packages_actual: number
  lines_planned: number
  lines_actual: number
  counterparty: string
  acceptance_date: Date | null
  client_tin: string
  client_join_id: string
  client_join_tin: string
  client_join_company: string
}

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserClientTINs(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clients: { select: { TIN: true } } }
    })

    return user?.clients?.map(client => client.TIN) || []
  }

  private parseDateTime(dateStr: string | undefined, isEndOfDay: boolean = false): Date | undefined {
    if (!dateStr) return undefined

    const trimmed = dateStr.trim()
    if (!trimmed) return undefined

    if (trimmed.includes('T') || trimmed.includes(' ')) {
      if (trimmed.includes('Z') || trimmed.match(/[+-]\d{2}:\d{2}$/)) {
        const date = new Date(trimmed)
        if (!isNaN(date.getTime())) {
          return date
        }
      } else {
        const dateStrWithZ = trimmed.endsWith('Z') ? trimmed : trimmed + 'Z'
        const date = new Date(dateStrWithZ)
        if (!isNaN(date.getTime())) {
          return date
        }
      }
    }

    const dateOnly = trimmed.split('T')[0].split(' ')[0]
    if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      if (isEndOfDay) {
        return new Date(dateOnly + 'T23:59:59.999Z')
      }
      return new Date(dateOnly + 'T00:00:00.000Z')
    }

    return undefined
  }

  private buildOrderFilterSql(dto: FindOrderDto, allowedTINs: string[], userRole: string): Prisma.Sql {
    const parts: Prisma.Sql[] = []

    if (allowedTINs.length > 0) {
      parts.push(Prisma.sql`o.client_tin IN (${Prisma.join(allowedTINs)})`)
    } else if (userRole !== 'ADMIN') {
      parts.push(Prisma.sql`FALSE`)
    }

    const branchTerm = dto.branch?.trim()
    if (branchTerm) {
      parts.push(Prisma.sql`o.branch ILIKE ${'%' + branchTerm + '%'}`)
    }

    const counterpartyTerm = dto.counterparty?.trim()
    if (counterpartyTerm) {
      parts.push(Prisma.sql`o.counterparty ILIKE ${'%' + counterpartyTerm + '%'}`)
    }

    const orderNumberTerm = dto.orderNumber?.trim()
    if (orderNumberTerm) {
      parts.push(Prisma.sql`o.order_number ILIKE ${'%' + orderNumberTerm + '%'}`)
    }

    const orderTypeTerm = dto.orderType?.trim()
    if (orderTypeTerm) {
      parts.push(Prisma.sql`o.order_type ILIKE ${'%' + orderTypeTerm + '%'}`)
    }

    const statusTerm = dto.status?.trim()
    if (statusTerm) {
      parts.push(Prisma.sql`o.status ILIKE ${'%' + statusTerm + '%'}`)
    }

    const kisNumberTerm = dto.kisNumber?.trim()
    if (kisNumberTerm) {
      parts.push(Prisma.sql`o.kis_number ILIKE ${'%' + kisNumberTerm + '%'}`)
    }

    const hasIndividualFieldFilters = !!(
      branchTerm ||
      counterpartyTerm ||
      orderNumberTerm ||
      orderTypeTerm ||
      statusTerm ||
      kisNumberTerm
    )
    const searchTerm = dto.search?.trim()
    if (searchTerm && !hasIndividualFieldFilters) {
      const p = '%' + searchTerm + '%'
      parts.push(Prisma.sql`(o.branch ILIKE ${p} OR o.counterparty ILIKE ${p} OR o.order_number ILIKE ${p} OR o.order_type ILIKE ${p} OR o.status ILIKE ${p} OR o.kis_number ILIKE ${p})`)
    }

    if (dto.acceptanceDateFrom || dto.acceptanceDateTo) {
      const gte = dto.acceptanceDateFrom ? this.parseDateTime(dto.acceptanceDateFrom, false) : undefined
      const lte = dto.acceptanceDateTo ? this.parseDateTime(dto.acceptanceDateTo, true) : undefined
      if (gte) parts.push(Prisma.sql`o.acceptance_date >= ${gte}`)
      if (lte) parts.push(Prisma.sql`o.acceptance_date <= ${lte}`)
    }

    if (dto.exportDateFrom || dto.exportDateTo) {
      const gte = dto.exportDateFrom ? this.parseDateTime(dto.exportDateFrom, false) : undefined
      const lte = dto.exportDateTo ? this.parseDateTime(dto.exportDateTo, true) : undefined
      if (gte) parts.push(Prisma.sql`o.export_date >= ${gte}`)
      if (lte) parts.push(Prisma.sql`o.export_date <= ${lte}`)
    }

    if (dto.shipmentDateFrom || dto.shipmentDateTo) {
      const gte = dto.shipmentDateFrom ? this.parseDateTime(dto.shipmentDateFrom, false) : undefined
      const lte = dto.shipmentDateTo ? this.parseDateTime(dto.shipmentDateTo, true) : undefined
      if (gte) parts.push(Prisma.sql`o.shipment_date >= ${gte}`)
      if (lte) parts.push(Prisma.sql`o.shipment_date <= ${lte}`)
    }

    return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`
  }

  private orderByClause(dto: FindOrderDto): Prisma.Sql {
    const asc = dto.sortOrder === 'asc'
    if (dto.sortBy === 'acceptanceDate') {
      return asc
        ? Prisma.sql`u.acceptance_date ASC NULLS FIRST, u.id ASC`
        : Prisma.sql`u.acceptance_date DESC NULLS LAST, u.id ASC`
    }
    if (dto.sortBy === 'exportDate') {
      return asc
        ? Prisma.sql`u.export_date ASC NULLS FIRST, u.id ASC`
        : Prisma.sql`u.export_date DESC NULLS LAST, u.id ASC`
    }
    if (dto.sortBy === 'shipmentDate') {
      return asc
        ? Prisma.sql`u.shipment_date ASC NULLS FIRST, u.id ASC`
        : Prisma.sql`u.shipment_date DESC NULLS LAST, u.id ASC`
    }
    return asc ? Prisma.sql`u.order_number ASC, u.id ASC` : Prisma.sql`u.order_number DESC, u.id ASC`
  }

  private mapUnifiedRow(r: UnifiedOrderRow) {
    return {
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      branch: r.branch,
      orderType: r.order_type,
      orderNumber: r.order_number,
      kisNumber: r.kis_number,
      exportDate: r.export_date,
      shipmentDate: r.shipment_date,
      status: r.status,
      packagesPlanned: r.packages_planned,
      packagesActual: r.packages_actual,
      linesPlanned: r.lines_planned,
      linesActual: r.lines_actual,
      counterparty: r.counterparty,
      acceptanceDate: r.acceptance_date,
      clientTIN: r.client_tin,
      client: {
        id: r.client_join_id,
        TIN: r.client_join_tin,
        companyName: r.client_join_company,
      },
    }
  }

  private selectUnionColumns = Prisma.sql`
    o.id, o.created_at, o.updated_at, o.branch, o.order_type, o.order_number, o.kis_number,
    o.export_date, o.shipment_date, o.status, o.packages_planned, o.packages_actual,
    o.lines_planned, o.lines_actual, o.counterparty, o.acceptance_date, o.client_tin
  `

  async findAll(userId: string, userRole: string, clientTINFilter?: string) {
    const userClientTINs = await this.getUserClientTINs(userId)

    let requestedTINs: string[] = []
    if (clientTINFilter) {
      requestedTINs = clientTINFilter.split(',').map(tin => tin.trim()).filter(Boolean)
    }

    let finalTINs: string[] = []

    if (userRole === 'ADMIN') {
      if (requestedTINs.length > 0) {
        finalTINs = requestedTINs
      } else {
        const MAX_RECORDS = 1000
        const whereSql = Prisma.sql`TRUE`
        const orderClause = Prisma.sql`u.created_at DESC, u.id ASC`
        const rows = await this.prisma.$queryRaw<UnifiedOrderRow[]>`
          WITH u AS (
            SELECT ${this.selectUnionColumns} FROM orders_save o WHERE ${whereSql}
            UNION ALL
            SELECT ${this.selectUnionColumns} FROM orders_online o WHERE ${whereSql}
          )
          SELECT u.id, u.created_at, u.updated_at, u.branch, u.order_type, u.order_number, u.kis_number,
                 u.export_date, u.shipment_date, u.status, u.packages_planned, u.packages_actual,
                 u.lines_planned, u.lines_actual, u.counterparty, u.acceptance_date, u.client_tin,
                 c.id AS client_join_id, c."TIN" AS client_join_tin, c."companyName" AS client_join_company
          FROM u
          JOIN client c ON c."TIN" = u.client_tin
          ORDER BY ${orderClause}
          LIMIT ${MAX_RECORDS}
        `
        return rows.map(r => this.mapUnifiedRow(r))
      }
    } else {
      if (userClientTINs.length === 0) {
        return []
      }

      if (requestedTINs.length > 0) {
        const allowedTINs = requestedTINs.filter(tin => userClientTINs.includes(tin))

        if (allowedTINs.length === 0) {
          throw new ForbiddenException('Access denied to the requested clients')
        }

        finalTINs = allowedTINs
      } else {
        finalTINs = userClientTINs
      }
    }

    const MAX_RECORDS = 1000
    const whereSql = Prisma.sql`o.client_tin IN (${Prisma.join(finalTINs)})`
    const orderClause = Prisma.sql`u.created_at DESC, u.id ASC`
    const rows = await this.prisma.$queryRaw<UnifiedOrderRow[]>`
      WITH u AS (
        SELECT ${this.selectUnionColumns} FROM orders_save o WHERE ${whereSql}
        UNION ALL
        SELECT ${this.selectUnionColumns} FROM orders_online o WHERE ${whereSql}
      )
      SELECT u.id, u.created_at, u.updated_at, u.branch, u.order_type, u.order_number, u.kis_number,
             u.export_date, u.shipment_date, u.status, u.packages_planned, u.packages_actual,
             u.lines_planned, u.lines_actual, u.counterparty, u.acceptance_date, u.client_tin,
             c.id AS client_join_id, c."TIN" AS client_join_tin, c."companyName" AS client_join_company
      FROM u
      JOIN client c ON c."TIN" = u.client_tin
      ORDER BY ${orderClause}
      LIMIT ${MAX_RECORDS}
    `
    return rows.map(r => this.mapUnifiedRow(r))
  }

  async findAllWithPagination(dto: FindOrderDto, userId: string, userRole: string) {
    const page = dto.page || 1
    const requestedLimit = dto.limit || 20
    const limit = requestedLimit > 50 ? Math.min(requestedLimit, 100000) : Math.min(requestedLimit, 50)
    const skip = (page - 1) * limit

    const userClientTINs = await this.getUserClientTINs(userId)

    let requestedTINs: string[] = []
    if (dto.clientTIN) {
      requestedTINs = dto.clientTIN.split(',').map(tin => tin.trim()).filter(Boolean)
    }

    let allowedTINs: string[] = []

    if (userRole === 'ADMIN') {
      allowedTINs = requestedTINs.length > 0 ? requestedTINs : []
    } else {
      if (userClientTINs.length === 0) {
        return {
          data: [],
          meta: {
            total: 0,
            page,
            limit,
            totalPages: 0,
          },
        }
      }

      if (requestedTINs.length > 0) {
        const filteredTINs = requestedTINs.filter(tin => userClientTINs.includes(tin))

        if (filteredTINs.length === 0) {
          throw new ForbiddenException('Access denied to the requested clients')
        }

        allowedTINs = filteredTINs
      } else {
        allowedTINs = userClientTINs
      }
    }

    if (allowedTINs.length === 0 && userRole !== 'ADMIN') {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      }
    }

    const whereSql = this.buildOrderFilterSql(dto, allowedTINs, userRole)
    const orderClause = this.orderByClause(dto)

    const countRows = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT (
        (SELECT COUNT(*)::bigint FROM orders_save o WHERE ${whereSql})
        + (SELECT COUNT(*)::bigint FROM orders_online o WHERE ${whereSql})
      ) AS total
    `
    const total = Number(countRows[0]?.total ?? 0)

    const rows = await this.prisma.$queryRaw<UnifiedOrderRow[]>`
      WITH u AS (
        SELECT ${this.selectUnionColumns} FROM orders_save o WHERE ${whereSql}
        UNION ALL
        SELECT ${this.selectUnionColumns} FROM orders_online o WHERE ${whereSql}
      )
      SELECT u.id, u.created_at, u.updated_at, u.branch, u.order_type, u.order_number, u.kis_number,
             u.export_date, u.shipment_date, u.status, u.packages_planned, u.packages_actual,
             u.lines_planned, u.lines_actual, u.counterparty, u.acceptance_date, u.client_tin,
             c.id AS client_join_id, c."TIN" AS client_join_tin, c."companyName" AS client_join_company
      FROM u
      JOIN client c ON c."TIN" = u.client_tin
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${skip}
    `

    return {
      data: rows.map(r => this.mapUnifiedRow(r)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    let order =
      (await this.prisma.orderOnline.findUnique({
        where: { id },
        include: { client: true },
      })) ||
      (await this.prisma.orderSave.findUnique({
        where: { id },
        include: { client: true },
      }))

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    if (userRole === 'ADMIN') {
      return order
    }

    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(order.clientTIN)) {
      throw new ForbiddenException('Access denied to this order')
    }

    return order
  }

  async create(dto: OrderDto, userId: string, userRole: string) {
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create order for this client')
      }
    }

    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN },
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.orderOnline.create({
      data: {
        branch: dto.branch,
        orderType: dto.orderType,
        orderNumber: dto.orderNumber,
        kisNumber: dto.kisNumber,
        exportDate: new Date(dto.exportDate),
        shipmentDate: dto.shipmentDate ? new Date(dto.shipmentDate) : null,
        status: dto.status,
        packagesPlanned: dto.packagesPlanned,
        packagesActual: dto.packagesActual,
        linesPlanned: dto.linesPlanned,
        linesActual: dto.linesActual,
        counterparty: dto.counterparty,
        acceptanceDate: dto.acceptanceDate ? new Date(dto.acceptanceDate) : null,
        clientTIN: dto.clientTIN,
      },
      include: { client: true },
    })
  }

  async update(id: string, dto: UpdateOrderDto, userId: string, userRole: string) {
    const online = await this.prisma.orderOnline.findUnique({ where: { id } })
    const save = online ? null : await this.prisma.orderSave.findUnique({ where: { id } })
    const order = online || save

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(order.clientTIN)) {
        throw new ForbiddenException('Access denied to update this order')
      }

      if (dto.clientTIN && dto.clientTIN !== order.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign order to this client')
        }
      }
    }

    if (dto.clientTIN && dto.clientTIN !== order.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN },
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    const data = {
      ...(dto.branch && { branch: dto.branch }),
      ...(dto.orderType && { orderType: dto.orderType }),
      ...(dto.orderNumber && { orderNumber: dto.orderNumber }),
      ...(dto.kisNumber && { kisNumber: dto.kisNumber }),
      ...(dto.exportDate && { exportDate: new Date(dto.exportDate) }),
      ...(dto.shipmentDate !== undefined && {
        shipmentDate: dto.shipmentDate ? new Date(dto.shipmentDate) : null,
      }),
      ...(dto.status && { status: dto.status }),
      ...(dto.packagesPlanned !== undefined && { packagesPlanned: dto.packagesPlanned }),
      ...(dto.packagesActual !== undefined && { packagesActual: dto.packagesActual }),
      ...(dto.linesPlanned !== undefined && { linesPlanned: dto.linesPlanned }),
      ...(dto.linesActual !== undefined && { linesActual: dto.linesActual }),
      ...(dto.counterparty && { counterparty: dto.counterparty }),
      ...(dto.acceptanceDate !== undefined && {
        acceptanceDate: dto.acceptanceDate ? new Date(dto.acceptanceDate) : null,
      }),
      ...(dto.clientTIN && { clientTIN: dto.clientTIN }),
    }

    if (online) {
      return this.prisma.orderOnline.update({
        where: { id },
        data,
        include: { client: true },
      })
    }
    return this.prisma.orderSave.update({
      where: { id },
      data,
      include: { client: true },
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const online = await this.prisma.orderOnline.findUnique({ where: { id } })
    const save = online ? null : await this.prisma.orderSave.findUnique({ where: { id } })
    const order = online || save

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(order.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this order')
      }
    }

    if (online) {
      return this.prisma.orderOnline.delete({
        where: { id },
        include: { client: true },
      })
    }
    return this.prisma.orderSave.delete({
      where: { id },
      include: { client: true },
    })
  }

  async getLastImportInfo() {
    const [onlineMetadata, ordersMetadata] = await Promise.all([
      this.prisma.importMetadata.findUnique({
        where: { importType: 'orders_online' },
      }),
      this.prisma.importMetadata.findUnique({
        where: { importType: 'orders' },
      }),
    ])

    const metadata = onlineMetadata ?? ordersMetadata

    if (!metadata) {
      return {
        lastImportAt: null,
        recordsImported: 0,
        recordsUpdated: 0,
        recordsDeleted: 0,
        recordsSkipped: 0,
        errors: 0,
      }
    }

    return {
      lastImportAt: metadata.lastImportAt,
      recordsImported: metadata.recordsImported,
      recordsUpdated: metadata.recordsUpdated,
      recordsDeleted: metadata.recordsDeleted,
      recordsSkipped: metadata.recordsSkipped,
      errors: metadata.errors,
    }
  }
}
